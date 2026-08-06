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

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { eq } from 'drizzle-orm';
import { createOrder } from '@/server/orders/service';
import { createOrderSchema } from '@/server/orders/contract';
import {
  createPurchaseOrder,
  updatePurchaseOrderStatus,
} from '@/server/purchase-orders/service';
import { getSession } from '@/lib/session';
import { GET } from './route';

afterEach(async () => {
  await resetTestDb(db);
  const session = (await getSession()) as unknown as Record<string, unknown>;
  for (const key of Object.keys(session)) delete session[key];
});

beforeEach(async () => {
  const session = (await getSession()) as unknown as Record<string, unknown>;
  session.userId = 'staff-1';
  session.role = 'sales';
  session.email = 'staff@example.com';
});

async function seedPo(opts: { supplierEmail?: string | null; approve?: boolean } = {}) {
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
  if (opts.approve !== false) await updatePurchaseOrderStatus(po.id, 'approved');
  return { po, orderId: created.orderId, orderNumber: created.orderNumber };
}

function getRequest(id: string, query = '') {
  return new NextRequest(
    `http://localhost/api/admin/purchase-orders/${id}/send-preview${query}`,
  );
}

const withId = (id: string) => ({ params: Promise.resolve({ id }) });

const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';

describe('GET /api/admin/purchase-orders/[id]/send-preview', () => {
  it('returns 404 for an unknown purchase order id', async () => {
    const res = await GET(getRequest(UNKNOWN_ID), withId(UNKNOWN_ID));
    expect(res.status).toBe(404);
  });

  it('mirrors the send guard for a DRAFT — approval must come first', async () => {
    const { po } = await seedPo({ approve: false });

    const res = await GET(getRequest(po.id), withId(po.id));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toBe('Move the purchase order to Review before sending it');
  });

  it('mirrors the send guard for a terminal status', async () => {
    const { po } = await seedPo();
    await updatePurchaseOrderStatus(po.id, 'sent');
    await updatePurchaseOrderStatus(po.id, 'received');

    const res = await GET(getRequest(po.id), withId(po.id));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toBe('Cannot send a received purchase order');
  });

  it('returns 409 when the supplier has no email address', async () => {
    const { po } = await seedPo({ supplierEmail: null });

    const res = await GET(getRequest(po.id), withId(po.id));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toBe('Supplier has no email address');
  });

  it('returns the composed email — recipient, subject, html, portal URL — without touching storage', async () => {
    const { po, orderNumber } = await seedPo();

    const res = await GET(getRequest(po.id), withId(po.id));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.to).toBe('factory@example.com');
    expect(json.toName).toBe('Li Wei'); // contactPerson wins over the supplier name
    expect(json.subject).toBe(`Purchase order ${po.poNumber} — BeastMode`);
    expect(json.html).toContain('Hi Li Wei,');
    expect(json.html).toContain(orderNumber);
    expect(json.portalUrl).toContain(`/supplier/VA/po/${po.poNumber}`);
    expect(json.html).toContain(json.portalUrl);
  });

  it('lists the PDF and XLSX filenames plus the snapshot attachments by name, fetching no bytes', async () => {
    const { po } = await seedPo();
    // Hand the latest revision a snapshot carrying every attachment kind. The
    // preview must list the SAME names collectSnapshotAttachments would use.
    const rev = (await db.query.purchaseOrderRevisions.findFirst({
      where: eq(schema.purchaseOrderRevisions.poId, po.id),
    }))!;
    const snapshot = {
      ...rev.snapshot,
      assets: [
        {
          kind: 'font' as const,
          name: 'TeamFont',
          url: null,
          storageKey: 'fonts/team.ttf',
          notes: null,
          garmentName: null,
        },
      ],
      garments: rev.snapshot.garments.map((g) => ({
        ...g,
        sizeCharts: [
          { id: 'c1', name: 'Hoodie chart', storageKey: 'charts/hoodie.png' },
          // Same chart on a second entry — deduped by storage key.
          { id: 'c2', name: 'Hoodie chart', storageKey: 'charts/hoodie.png' },
        ],
        images: [
          { id: 'i1', storageKey: 'mockups/front.png', thumbnailStorageKey: null, caption: 'Front' },
          { id: 'i2', storageKey: 'mockups/b.jpg', thumbnailStorageKey: null, caption: null },
        ],
      })),
    };
    await db
      .update(schema.purchaseOrderRevisions)
      .set({ snapshot })
      .where(eq(schema.purchaseOrderRevisions.id, rev.id));

    const res = await GET(getRequest(po.id), withId(po.id));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.attachments.map((a: { filename: string }) => a.filename)).toEqual([
      `${po.poNumber}.pdf`,
      `${po.poNumber}.xlsx`,
      'TeamFont.ttf',
      'size-chart-Hoodie chart.png',
      'Team Hoodie-Front.png',
      'Team Hoodie-2.jpg',
    ]);
  });

  it('re-composes with the ?messageIntro= paragraph, escaped', async () => {
    const { po } = await seedPo();

    const res = await GET(
      getRequest(po.id, `?messageIntro=${encodeURIComponent('Rush job <please> & hurry')}`),
      withId(po.id),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.html).toContain('Rush job &lt;please&gt; &amp; hurry');
    expect(json.html).not.toContain('Rush job <please>');
  });

  it('still previews when the pre-send checklist and workflow gate are outstanding', async () => {
    // The preview deliberately skips the soft gates — the modal surfaces those
    // as blockers when the actual send 409s. Nothing here satisfied either.
    const { po } = await seedPo();

    const res = await GET(getRequest(po.id), withId(po.id));

    expect(res.status).toBe(200);
  });
});
