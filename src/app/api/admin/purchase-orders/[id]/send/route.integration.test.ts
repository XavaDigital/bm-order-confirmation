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
import { and, eq, isNull } from 'drizzle-orm';
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
  session.role = 'sales';
  session.email = 'staff@example.com';
});

async function seedPo(
  opts: {
    supplierEmail?: string | null;
    satisfyGate?: boolean;
    approve?: boolean;
    satisfyChecklist?: boolean;
  } = {},
) {
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
  // Sending is gated on the order's pre-production checklist (migration 0020
  // seeds five tasks carrying `po_send`). These tests are about the SEND, so
  // satisfy the gate unless a test is specifically exercising it.
  if (opts.satisfyGate !== false) await satisfyPoSendGate(created.orderId);
  // The PO's own pre-send checklist (migration 0041 seeds four items) also
  // gates the send — tick everything unless a test exercises the refusal.
  if (opts.satisfyChecklist !== false) await satisfyPoChecklist(po.id);
  // Drafts cannot send since the APPROVED status landed (David, 2026-08-05) —
  // approve by default so the send tests exercise the send, not the gate.
  if (opts.approve !== false) await updatePurchaseOrderStatus(po.id, 'approved');
  return { po, orderId: created.orderId, orderNumber: created.orderNumber };
}

/** Tick every active pre-send checklist item for this PO (auto ones included —
 *  a manual tick satisfies an auto item too, so this is the cheap blanket). */
async function satisfyPoChecklist(poId: string) {
  const items = await db.query.poChecklistItems.findMany({
    where: eq(schema.poChecklistItems.isActive, true),
  });
  if (items.length === 0) return;
  await db.insert(schema.poChecklistCompletions).values(
    items.map((item) => ({ poId, itemId: item.id, checkedByEmail: 'seed@example.com' })),
  );
}

/** Tick every task feeding the po_send gate for this order. */
async function satisfyPoSendGate(orderId: string) {
  const tasks = await db.select().from(schema.workflowStageTasks);
  const gated = tasks.filter((task) => task.gateKeys.includes('po_send'));
  if (gated.length === 0) return;
  await db.insert(schema.workflowTaskCompletions).values(
    gated.map((task) => ({
      taskId: task.id,
      entityType: 'order' as const,
      entityId: orderId,
      confirmedByStaffUserId: null,
      confirmedByEmail: 'seed@example.com',
    })),
  );
}

function postRequest(id: string, body?: unknown) {
  return new NextRequest(`http://localhost/api/admin/purchase-orders/${id}/send`, {
    method: 'POST',
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
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

  it('returns 409 for a DRAFT — approval must come first (David, 2026-08-05)', async () => {
    const { po } = await seedPo({ approve: false });

    const res = await POST(postRequest(po.id), withId(po.id));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toBe('Move the purchase order to Review before sending it');
    expect(sendSupplierPoEmail).not.toHaveBeenCalled();
  });

  it('sends the latest revision PDF, moves approved → sent with a sentAt stamp, and records po.sent', async () => {
    const { po, orderId, orderNumber } = await seedPo();

    const res = await POST(postRequest(po.id), withId(po.id));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      ok: true,
      poNumber: po.poNumber,
      to: 'factory@example.com',
      attachmentSummary: { images: 0, fonts: 0, sizeCharts: 0, sizeReduced: false },
    });

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

    // The email carries the PRETTY per-PO portal URL (David, 2026-08-05) —
    // deterministic from the PO number, no token minted anymore.
    expect(typeof emailArgs.portalUrl).toBe('string');
    expect(emailArgs.portalUrl).toContain(`/supplier/VA/po/${po.poNumber}`);
    const activeLink = await db.query.poSupplierAccess.findFirst({
      where: and(eq(schema.poSupplierAccess.purchaseOrderId, po.id), isNull(schema.poSupplierAccess.revokedAt)),
    });
    expect(activeLink).toBeUndefined();

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
    await POST(postRequest(po.id), withId(po.id)); // first send: approved → sent
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
    // A mid-production resend is legal since 2026-08-05 (revisions can chase a
    // job on the floor) — only the terminal/receipt statuses refuse.
    await updatePurchaseOrderStatus(po.id, 'received');

    const res = await POST(postRequest(po.id), withId(po.id));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toBe('Cannot send a received purchase order');
    expect(sendSupplierPoEmail).not.toHaveBeenCalled();
  });

  it('returns 500 with the underlying message when the SMTP send fails, leaving the PO approved', async () => {
    sendSupplierPoEmail.mockRejectedValueOnce(new Error('SMTP exploded'));
    const { po } = await seedPo();

    const res = await POST(postRequest(po.id), withId(po.id));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe('SMTP exploded');

    const updated = (await db.query.purchaseOrders.findFirst({
      where: eq(schema.purchaseOrders.id, po.id),
    }))!;
    expect(updated.status).toBe('approved');
    expect(updated.sentAt).toBeNull();
  });

  it('threads the messageIntro from the preview modal into the supplier email', async () => {
    const { po } = await seedPo();

    const res = await POST(
      postRequest(po.id, { messageIntro: 'Rush job — ship by Friday' }),
      withId(po.id),
    );

    expect(res.status).toBe(200);
    expect(sendSupplierPoEmail.mock.calls[0][0]).toMatchObject({
      messageIntro: 'Rush job — ship by Friday',
    });
  });

  it('collapses a whitespace-only messageIntro to none', async () => {
    const { po } = await seedPo();

    const res = await POST(postRequest(po.id, { messageIntro: '   ' }), withId(po.id));

    expect(res.status).toBe(200);
    expect(sendSupplierPoEmail.mock.calls[0][0].messageIntro).toBeNull();
  });

  it('rejects a messageIntro over 2000 characters at the contract', async () => {
    const { po } = await seedPo();

    const res = await POST(postRequest(po.id, { messageIntro: 'x'.repeat(2001) }), withId(po.id));

    expect(res.status).toBe(400);
    expect(sendSupplierPoEmail).not.toHaveBeenCalled();
  });

  it('returns 409 naming the outstanding pre-send checklist items, and sends no email', async () => {
    const { po } = await seedPo({ satisfyChecklist: false });

    const res = await POST(postRequest(po.id), withId(po.id));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toMatch(/^Pre-send checklist incomplete: /);
    // The two manual items from migration 0041 are necessarily outstanding.
    expect(json.error).toContain('Design file includes colours');
    expect(sendSupplierPoEmail).not.toHaveBeenCalled();
  });

  it('lets the admin gate override bypass the pre-send checklist too', async () => {
    const { po } = await seedPo({ satisfyChecklist: false });
    const session = (await getSession()) as unknown as Record<string, unknown>;
    session.role = 'admin';

    const res = await POST(
      postRequest(po.id, { overrideReason: 'Factory needs the doc today; checks to follow' }),
      withId(po.id),
    );

    expect(res.status).toBe(200);
    expect(sendSupplierPoEmail).toHaveBeenCalledTimes(1);
  });
});

/**
 * The check the plan named as highest-value for this phase: a gated send must
 * return 409 AND send no email. A gate that blocks the status but still emails
 * the factory would be worse than no gate at all.
 */
describe('POST /api/admin/purchase-orders/[id]/send — pre-production gate', () => {
  it('refuses to send while checks are outstanding, and sends no email', async () => {
    const { po } = await seedPo({ satisfyGate: false });

    const res = await POST(postRequest(po.id), withId(po.id));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toMatch(/blocked by outstanding checks/i);
    expect(sendSupplierPoEmail).not.toHaveBeenCalled();

    const after = (await db.query.purchaseOrders.findFirst({
      where: eq(schema.purchaseOrders.id, po.id),
    }))!;
    expect(after.status).toBe('approved');
    expect(after.sentAt).toBeNull();
  });

  it('lists the outstanding checks so the UI can show them', async () => {
    const { po } = await seedPo({ satisfyGate: false });

    const json = await (await POST(postRequest(po.id), withId(po.id))).json();

    expect(json.details.gateKey).toBe('po_send');
    expect(json.details.outstanding.map((t: { slug: string }) => t.slug)).toContain(
      'artwork_approved',
    );
  });

  it('sends once the checks are satisfied', async () => {
    const { po, orderId } = await seedPo({ satisfyGate: false });
    await satisfyPoSendGate(orderId);

    const res = await POST(postRequest(po.id), withId(po.id));

    expect(res.status).toBe(200);
    expect(sendSupplierPoEmail).toHaveBeenCalledTimes(1);
  });

  it('lets an admin override with a reason, and records why', async () => {
    const { po, orderId } = await seedPo({ satisfyGate: false });
    const session = (await getSession()) as unknown as Record<string, unknown>;
    session.role = 'admin';

    const res = await POST(
      postRequest(po.id, { overrideReason: 'Customer accepted the risk in writing' }),
      withId(po.id),
    );

    expect(res.status).toBe(200);
    expect(sendSupplierPoEmail).toHaveBeenCalledTimes(1);

    const audit = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'workflow.gate_overridden'));
    expect(audit).toHaveLength(1);
    expect(audit[0].payload).toMatchObject({
      gateKey: 'po_send',
      reason: 'Customer accepted the risk in writing',
      poNumber: po.poNumber,
    });
    expect(audit[0].actorEmail).toBe('staff@example.com');
  });

  // Skipping a safety check is a management decision, not a routine one.
  it('refuses an override from a non-admin, and sends no email', async () => {
    const { po } = await seedPo({ satisfyGate: false });
    const session = (await getSession()) as unknown as Record<string, unknown>;
    session.role = 'sales';

    const res = await POST(postRequest(po.id, { overrideReason: 'in a hurry' }), withId(po.id));

    expect(res.status).toBe(403);
    expect(sendSupplierPoEmail).not.toHaveBeenCalled();
  });

  it('rejects an empty override reason at the contract', async () => {
    const { po } = await seedPo({ satisfyGate: false });
    const session = (await getSession()) as unknown as Record<string, unknown>;
    session.role = 'admin';

    const res = await POST(postRequest(po.id, { overrideReason: '   ' }), withId(po.id));

    expect(res.status).toBe(400);
    expect(sendSupplierPoEmail).not.toHaveBeenCalled();
  });
});
