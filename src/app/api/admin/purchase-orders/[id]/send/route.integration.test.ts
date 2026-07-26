import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/db', async () => {
  const { createTestDb } = await import('@/db/test-helpers');
  const schema = await import('@/db/schema');
  const { db } = await createTestDb();
  return { db, schema };
});

vi.mock('@/lib/session', () => {
  const store: Record<string, unknown> = {};
  const session = new Proxy(store, {
    get(target, prop) {
      if (prop === 'save') return async () => {};
      if (prop === 'destroy') return () => { for (const k of Object.keys(target)) delete target[k]; };
      return target[prop as string];
    },
    set(target, prop, value) {
      target[prop as string] = value;
      return true;
    },
  });
  return { getSession: vi.fn(async () => session) };
});

const { sendSupplierPoEmail, isEmailConfigured } = vi.hoisted(() => ({
  sendSupplierPoEmail: vi.fn().mockResolvedValue(undefined),
  isEmailConfigured: vi.fn().mockReturnValue(true),
}));

vi.mock('@/lib/email', () => ({ sendSupplierPoEmail, isEmailConfigured }));

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { eq } from 'drizzle-orm';
import { createOrder } from '@/server/orders/service';
import { createOrderSchema } from '@/server/orders/contract';
import {
  createPurchaseOrder,
  issueRevision,
  updatePurchaseOrderStatus,
} from '@/server/purchase-orders/service';
import { getSession } from '@/lib/session';
import { POST } from './route';

afterEach(async () => {
  await resetTestDb(db);
  sendSupplierPoEmail.mockClear();
  isEmailConfigured.mockReturnValue(true);
  const session = (await getSession()) as unknown as Record<string, unknown>;
  for (const key of Object.keys(session)) delete session[key];
});

beforeEach(async () => {
  const session = (await getSession()) as unknown as Record<string, unknown>;
  session.userId = 'staff-1';
  session.email = 'staff@example.com';
});

async function seedPo(opts: { supplierEmail?: string | null } = {}) {
  const [supplier] = await db
    .insert(schema.suppliers)
    .values({
      name: 'Vast Apparel',
      supplierCode: 'VA',
      contactPerson: 'Li Wei',
      email: opts.supplierEmail === undefined ? 'factory@example.com' : opts.supplierEmail,
    })
    .returning();
  const created = await createOrder(
    createOrderSchema.parse({
      customer: { name: 'Jane Coach', email: 'jane@example.com' },
      garments: [{ name: 'Team Hoodie', sizing: [{ size: 'M', playerName: 'Alice' }] }],
    }),
  );
  const garment = (await db.query.garments.findFirst({
    where: eq(schema.garments.orderId, created.orderId),
  }))!;
  const po = await createPurchaseOrder({
    orderId: created.orderId,
    supplierId: supplier.id,
    garmentIds: [garment.id],
  });
  return { po, orderId: created.orderId, orderNumber: created.orderNumber };
}

function postRequest(id: string) {
  return new NextRequest(`http://localhost/api/admin/purchase-orders/${id}/send`, {
    method: 'POST',
  });
}

const withId = (id: string) => ({ params: Promise.resolve({ id }) });

const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';

describe('POST /api/admin/purchase-orders/[id]/send', () => {
  it('returns 503 when email is not configured', async () => {
    isEmailConfigured.mockReturnValue(false);
    const { po } = await seedPo();

    const res = await POST(postRequest(po.id), withId(po.id));
    const json = await res.json();

    expect(res.status).toBe(503);
    expect(json.error).toBe('Email delivery is not configured on this server.');
    expect(sendSupplierPoEmail).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown purchase order id', async () => {
    const res = await POST(postRequest(UNKNOWN_ID), withId(UNKNOWN_ID));
    expect(res.status).toBe(404);
  });

  it('returns 409 when the supplier has no email address', async () => {
    const { po } = await seedPo({ supplierEmail: null });

    const res = await POST(postRequest(po.id), withId(po.id));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toBe('Supplier has no email address');
    expect(sendSupplierPoEmail).not.toHaveBeenCalled();
  });

  it('sends the latest revision PDF, moves draft → sent with a sentAt stamp, and records po.sent', async () => {
    const { po, orderId, orderNumber } = await seedPo();

    const res = await POST(postRequest(po.id), withId(po.id));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, poNumber: po.poNumber, to: 'factory@example.com' });

    expect(sendSupplierPoEmail).toHaveBeenCalledTimes(1);
    const emailArgs = sendSupplierPoEmail.mock.calls[0][0];
    expect(emailArgs).toMatchObject({
      to: 'factory@example.com',
      toName: 'Li Wei', // contactPerson wins over the supplier name
      poNumber: po.poNumber,
      orderNumber,
      revisionNumber: 1,
      reason: null,
    });
    expect(Buffer.isBuffer(emailArgs.pdf)).toBe(true);
    expect(emailArgs.pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');

    const updated = (await db.query.purchaseOrders.findFirst({
      where: eq(schema.purchaseOrders.id, po.id),
    }))!;
    expect(updated.status).toBe('sent');
    expect(updated.sentAt).toBeInstanceOf(Date);

    const audits = await db.query.auditEvents.findMany({
      where: eq(schema.auditEvents.aggregateId, orderId),
    });
    expect(audits.some((e) => e.eventType === 'po.sent' && e.actorEmail === 'staff@example.com')).toBe(true);

    const events = await db.query.domainEvents.findMany({
      where: eq(schema.domainEvents.aggregateId, orderId),
    });
    expect(events.some((e) => e.eventType === 'po.sent')).toBe(true);
  });

  it('resends an already-sent PO (revision > 1 gets the amended subject inputs) without touching status', async () => {
    const { po } = await seedPo();
    await POST(postRequest(po.id), withId(po.id)); // first send: draft → sent
    await issueRevision(po.id, { reason: 'sizes corrected' });
    sendSupplierPoEmail.mockClear();

    const res = await POST(postRequest(po.id), withId(po.id));

    expect(res.status).toBe(200);
    expect(sendSupplierPoEmail.mock.calls[0][0]).toMatchObject({
      revisionNumber: 2,
      reason: 'sizes corrected',
    });
    const updated = (await db.query.purchaseOrders.findFirst({
      where: eq(schema.purchaseOrders.id, po.id),
    }))!;
    expect(updated.status).toBe('sent');
  });

  it('returns 409 for a status that does not allow sending', async () => {
    const { po } = await seedPo();
    await updatePurchaseOrderStatus(po.id, 'in_production');

    const res = await POST(postRequest(po.id), withId(po.id));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toBe('Cannot send a in_production purchase order');
    expect(sendSupplierPoEmail).not.toHaveBeenCalled();
  });

  it('returns 500 with the underlying message when the SMTP send fails, leaving the PO draft', async () => {
    sendSupplierPoEmail.mockRejectedValueOnce(new Error('SMTP exploded'));
    const { po } = await seedPo();

    const res = await POST(postRequest(po.id), withId(po.id));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe('SMTP exploded');

    const updated = (await db.query.purchaseOrders.findFirst({
      where: eq(schema.purchaseOrders.id, po.id),
    }))!;
    expect(updated.status).toBe('draft');
    expect(updated.sentAt).toBeNull();
  });
});
