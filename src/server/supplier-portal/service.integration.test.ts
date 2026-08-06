import { afterEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';

vi.mock('@/db', async () => {
  const { createTestDb } = await import('@/db/test-helpers');
  const schema = await import('@/db/schema');
  const { db } = await createTestDb();
  return { db, schema };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { createOrder } from '@/server/orders/service';
import { createOrderSchema } from '@/server/orders/contract';
import { addOrderNote } from '@/server/orders/notes-service';
import {
  createPurchaseOrder,
  issueRevision,
  updatePurchaseOrderStatus,
} from '@/server/purchase-orders/service';
import { generateToken } from '@/lib/tokens';
import { insertToken, revokeActiveTokens } from '@/server/access/tokens';
import {
  addSupplierComment,
  addSupplierCommentByNumber,
  getSupplierByPortalCode,
  listSupplierPos,
  resolveSupplierPortalView,
  resolveSupplierPoViewByNumber,
  supplierPasswordMatches,
  updateSupplierPoShipDate,
  updateSupplierPoStatus,
  updateSupplierPoStatusByNumber,
} from './service';

afterEach(async () => {
  await resetTestDb(db);
});

async function seedSupplier(overrides: Partial<typeof schema.suppliers.$inferInsert> = {}) {
  const [supplier] = await db
    .insert(schema.suppliers)
    .values({
      name: 'Vast Apparel',
      supplierCode: 'VA',
      email: 'factory@example.com',
      portalPassword: 'fish-tuesday',
      ...overrides,
    })
    .returning();
  return supplier;
}

async function seedOrder() {
  const created = await createOrder(
    createOrderSchema.parse({
      customer: { name: 'Jane Coach', email: 'jane@example.com' },
      // Customer deadline set on purpose: the portal DTO must never carry it.
      deadlineDate: '2026-09-30',
      garments: [
        { name: 'Team Hoodie', sizing: [{ size: 'M', playerName: 'Alice', playerNumber: '7' }] },
      ],
    }),
  );
  const garments = await db.query.garments.findMany({
    where: eq(schema.garments.orderId, created.orderId),
  });
  return { orderId: created.orderId, garmentId: garments[0].id };
}

/**
 * The PO-service link minting functions are GONE (2026-08-05) — legacy tokens
 * already in inboxes still resolve, so tests mint rows directly against
 * po_supplier_access via the shared access-token machinery.
 */
async function mintPortalToken(purchaseOrderId: string): Promise<string> {
  const rawToken = generateToken();
  await insertToken(db, schema.poSupplierAccess, rawToken, { purchaseOrderId });
  return rawToken;
}

async function revokePortalTokens(purchaseOrderId: string): Promise<void> {
  await revokeActiveTokens(
    db,
    schema.poSupplierAccess,
    eq(schema.poSupplierAccess.purchaseOrderId, purchaseOrderId),
  );
}

async function seedPoWithToken() {
  const supplier = await seedSupplier();
  const { orderId, garmentId } = await seedOrder();
  const po = await createPurchaseOrder({
    orderId,
    supplierId: supplier.id,
    garmentIds: [garmentId],
  });
  await updatePurchaseOrderStatus(po.id, 'sent');
  const rawToken = await mintPortalToken(po.id);
  return { po, orderId, supplier, rawToken };
}

describe('resolveSupplierPortalView (legacy token gate)', () => {
  it('returns the PO snapshot, allowed next statuses, and shared comments only', async () => {
    const { po, orderId, rawToken } = await seedPoWithToken();

    await addOrderNote(orderId, {
      body: 'internal pricing chat',
      authorKind: 'staff',
      isHtml: false,
    });
    await addSupplierComment(rawToken, 'When do you need the artwork?');

    const view = await resolveSupplierPortalView(rawToken);

    expect(view.poId).toBe(po.id);
    expect(view.poNumber).toBe(po.poNumber);
    expect(view.status).toBe('sent');
    // 'sent' → every supplier-safe status is still ahead of it, in chain
    // order. 'confirmed' dropped out of the subset (2026-08-05): moving to
    // Design Prep IS the confirmation now.
    expect(view.allowedNextStatuses).toEqual([
      'pre_production',
      'test_print',
      'prod_layout',
      'in_production',
      'quality_control',
      'in_transit',
    ]);
    expect(view.snapshot.garments).toHaveLength(1);
    expect(view.snapshot.garments[0].lines[0]).toMatchObject({ playerName: 'Alice' });

    // The CUSTOMER deadline must never reach the supplier view.
    expect(view).not.toHaveProperty('deadlineDate');
    expect(JSON.stringify(view)).not.toContain('2026-09-30');

    // The internal-by-default staff note must NEVER reach the supplier view —
    // this is the leak the visibility column exists to prevent.
    expect(view.comments).toHaveLength(1);
    expect(view.comments[0].body).toBe('When do you need the artwork?');
    expect(view.comments[0].authorKind).toBe('supplier');
  });

  it('stamps lastViewedAt on the access row', async () => {
    const { po, rawToken } = await seedPoWithToken();
    await resolveSupplierPortalView(rawToken);

    const [access] = await db
      .select()
      .from(schema.poSupplierAccess)
      .where(eq(schema.poSupplierAccess.purchaseOrderId, po.id));
    expect(access.lastViewedAt).toBeInstanceOf(Date);
  });

  it('throws invalid_token for an unknown, revoked, or garbage token', async () => {
    const { po, rawToken } = await seedPoWithToken();

    await expect(resolveSupplierPortalView('not-a-real-token')).rejects.toThrow('invalid_token');

    await revokePortalTokens(po.id);
    await expect(resolveSupplierPortalView(rawToken)).rejects.toThrow('invalid_token');
  });
});

describe('updateSupplierPoStatus (legacy token gate)', () => {
  it('moves the PO forward, emits po.supplier_updated distinctly from po.status_changed, and audits the supplier as actor', async () => {
    const { po, orderId, rawToken, supplier } = await seedPoWithToken();

    const result = await updateSupplierPoStatus(rawToken, 'pre_production');
    expect(result.status).toBe('pre_production');

    const updated = await db.query.purchaseOrders.findFirst({
      where: eq(schema.purchaseOrders.id, po.id),
    });
    expect(updated!.status).toBe('pre_production');

    const supplierEvents = await db.query.domainEvents.findMany({
      where: and(
        eq(schema.domainEvents.aggregateId, orderId),
        eq(schema.domainEvents.eventType, 'po.supplier_updated'),
      ),
    });
    expect(supplierEvents).toHaveLength(1);
    expect(supplierEvents[0].payload).toMatchObject({
      poId: po.id,
      from: 'sent',
      to: 'pre_production',
      supplierId: supplier.id,
      supplierName: supplier.name,
    });

    // The normal po.status_changed event/audit still fire underneath — one
    // status machine, not a parallel supplier-only path. (seedPoWithToken's
    // own draft → sent move already accounts for one of these two.)
    const statusChanged = await db.query.domainEvents.findMany({
      where: and(
        eq(schema.domainEvents.aggregateId, orderId),
        eq(schema.domainEvents.eventType, 'po.status_changed'),
      ),
    });
    expect(statusChanged).toHaveLength(2);
    expect(statusChanged.map((e) => e.payload)).toEqual(
      expect.arrayContaining([{ poId: po.id, poNumber: po.poNumber, from: 'sent', to: 'pre_production' }]),
    );

    const audits = await db.query.auditEvents.findMany({
      where: and(
        eq(schema.auditEvents.aggregateId, orderId),
        eq(schema.auditEvents.eventType, 'po.supplier_updated'),
      ),
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].actorEmail).toContain(supplier.name);
    // aggregateType defaults to 'order' — required for getOrderAuditLog to
    // pick this row up (it filters strictly on aggregateType: 'order').
    expect(audits[0].aggregateType).toBe('order');
  });

  it('rejects a status outside the supplier-safe subset (confirmed is no longer allowed)', async () => {
    const { rawToken } = await seedPoWithToken();

    for (const disallowed of ['confirmed', 'received', 'completed', 'sent', 'cancelled', 'remake'] as const) {
      // @ts-expect-error — exercising the runtime guard against out-of-union values too.
      await expect(updateSupplierPoStatus(rawToken, disallowed)).rejects.toThrow('status_not_allowed');
    }
  });

  it('rejects an illegal transition even within the allowed subset (no backward moves)', async () => {
    const { po, rawToken } = await seedPoWithToken();
    await updatePurchaseOrderStatus(po.id, 'in_transit');

    await expect(updateSupplierPoStatus(rawToken, 'pre_production')).rejects.toThrow('illegal_transition');
  });

  it('throws invalid_token for a revoked link', async () => {
    const { po, rawToken } = await seedPoWithToken();
    await revokePortalTokens(po.id);

    await expect(updateSupplierPoStatus(rawToken, 'pre_production')).rejects.toThrow('invalid_token');
  });
});

describe('addSupplierComment (legacy token gate)', () => {
  it('adds a shared, supplier-authored note visible in the order thread', async () => {
    const { po, orderId, rawToken, supplier } = await seedPoWithToken();

    const note = await addSupplierComment(rawToken, 'Fabric arrives Tuesday.');

    expect(note.authorKind).toBe('supplier');
    expect(note.visibility).toBe('shared');
    expect(note.authorLabel).toContain(supplier.name);
    expect(note.authorLabel).toContain(po.poNumber);

    const rows = await db.query.orderNotes.findMany({
      where: eq(schema.orderNotes.orderId, orderId),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].visibility).toBe('shared');
  });

  it('throws invalid_token for a bad token', async () => {
    await expect(addSupplierComment('garbage', 'hello')).rejects.toThrow('invalid_token');
  });
});

// ---------------------------------------------------------------------------
// Gate 2 — the per-supplier password portal (David, 2026-08-05)
// ---------------------------------------------------------------------------

describe('getSupplierByPortalCode', () => {
  it('matches the stored uppercase code case-insensitively', async () => {
    const supplier = await seedSupplier();
    expect((await getSupplierByPortalCode('VA'))?.id).toBe(supplier.id);
    expect((await getSupplierByPortalCode('va'))?.id).toBe(supplier.id);
    expect((await getSupplierByPortalCode(' va '))?.id).toBe(supplier.id);
  });

  it('returns null for unknown or blank codes', async () => {
    await seedSupplier();
    expect(await getSupplierByPortalCode('NOPE')).toBeNull();
    expect(await getSupplierByPortalCode('')).toBeNull();
    expect(await getSupplierByPortalCode('   ')).toBeNull();
  });
});

describe('supplierPasswordMatches', () => {
  it('accepts the right password and rejects a wrong one', () => {
    const supplier = { portalPassword: 'fish-tuesday', isActive: true };
    expect(supplierPasswordMatches(supplier, 'fish-tuesday')).toBe(true);
    expect(supplierPasswordMatches(supplier, 'fish-wednesday')).toBe(false);
    expect(supplierPasswordMatches(supplier, 'fish-tuesda')).toBe(false); // length differs
    expect(supplierPasswordMatches(supplier, '')).toBe(false);
  });

  it('always rejects when the supplier is inactive or has no password (closed portal)', () => {
    expect(
      supplierPasswordMatches({ portalPassword: 'fish-tuesday', isActive: false }, 'fish-tuesday'),
    ).toBe(false);
    expect(supplierPasswordMatches({ portalPassword: null, isActive: true }, 'anything')).toBe(false);
    expect(supplierPasswordMatches({ portalPassword: null, isActive: true }, '')).toBe(false);
  });
});

describe('listSupplierPos', () => {
  it('hides draft AND approved POs — only sent-or-later reach the portal table', async () => {
    const supplier = await seedSupplier();
    const { orderId, garmentId } = await seedOrder();

    const draftPo = await createPurchaseOrder({
      orderId,
      supplierId: supplier.id,
      garmentIds: [garmentId],
    });
    const approvedPo = await createPurchaseOrder({
      orderId,
      supplierId: supplier.id,
      garmentIds: [garmentId],
    });
    await updatePurchaseOrderStatus(approvedPo.id, 'approved');
    const sentPo = await createPurchaseOrder({
      orderId,
      supplierId: supplier.id,
      garmentIds: [garmentId],
    });
    await updatePurchaseOrderStatus(sentPo.id, 'sent');

    const rows = await listSupplierPos(supplier.id);
    expect(rows.map((r) => r.poId)).toEqual([sentPo.id]);
    expect(rows.map((r) => r.poId)).not.toContain(draftPo.id);
    expect(rows[0]).toMatchObject({
      poNumber: sentPo.poNumber,
      status: 'sent',
      revisionNumber: 1,
      garmentNames: ['Team Hoodie'],
      totalUnits: 1,
    });
    expect(rows[0].allowedNextStatuses).toEqual([
      'pre_production',
      'test_print',
      'prod_layout',
      'in_production',
      'quality_control',
      'in_transit',
    ]);
  });

  it('never lists another supplier\'s POs', async () => {
    const { supplier } = await seedPoWithToken();
    const rival = await seedSupplier({ name: 'Goal Sports', supplierCode: 'GOAL' });

    expect(await listSupplierPos(rival.id)).toEqual([]);
    expect((await listSupplierPos(supplier.id)).length).toBe(1);
  });
});

describe('resolveSupplierPoViewByNumber', () => {
  it('serves the same portal view by PO number, without the customer deadline', async () => {
    const { po, supplier } = await seedPoWithToken();

    const view = await resolveSupplierPoViewByNumber(supplier.id, po.poNumber);
    expect(view.poId).toBe(po.id);
    expect(view.poNumber).toBe(po.poNumber);
    expect(view).not.toHaveProperty('deadlineDate');
    expect(JSON.stringify(view)).not.toContain('2026-09-30');
  });

  it('answers po_not_found for a draft/approved PO, an unknown number, and the wrong supplier', async () => {
    const supplier = await seedSupplier();
    const { orderId, garmentId } = await seedOrder();
    const po = await createPurchaseOrder({
      orderId,
      supplierId: supplier.id,
      garmentIds: [garmentId],
    });

    // Unsent (draft) — invisible, indistinguishable from absent.
    await expect(resolveSupplierPoViewByNumber(supplier.id, po.poNumber)).rejects.toThrow('po_not_found');
    await updatePurchaseOrderStatus(po.id, 'approved');
    await expect(resolveSupplierPoViewByNumber(supplier.id, po.poNumber)).rejects.toThrow('po_not_found');

    await updatePurchaseOrderStatus(po.id, 'sent');
    await expect(resolveSupplierPoViewByNumber(supplier.id, po.poNumber)).resolves.toBeDefined();

    // Unknown number, and a valid number probed by the WRONG supplier.
    await expect(resolveSupplierPoViewByNumber(supplier.id, 'VA999')).rejects.toThrow('po_not_found');
    const rival = await seedSupplier({ name: 'Goal Sports', supplierCode: 'GOAL' });
    await expect(resolveSupplierPoViewByNumber(rival.id, po.poNumber)).rejects.toThrow('po_not_found');
  });
});

describe('revision stepping (SupplierPortalViewDto.revisions + the revisionNumber param)', () => {
  /** Revision 2 with real content drift: the sizing row's size changes M → L. */
  async function seedRevisedPo() {
    const seeded = await seedPoWithToken();
    await db
      .update(schema.garmentSizing)
      .set({ size: 'L' })
      .where(eq(schema.garmentSizing.size, 'M'));
    await issueRevision(seeded.po.id, { reason: 'Size fix' });
    return seeded;
  }

  it('lists all revisions ascending (reason, createdAt) and serves the latest by default', async () => {
    const { po, supplier } = await seedRevisedPo();

    const view = await resolveSupplierPoViewByNumber(supplier.id, po.poNumber);
    expect(view.revisionNumber).toBe(2);
    expect(view.revisions.map((r) => r.revisionNumber)).toEqual([1, 2]);
    expect(view.revisions[0].reason).toBeNull(); // rev 1 is the original
    expect(view.revisions[1].reason).toBe('Size fix');
    for (const rev of view.revisions) {
      expect(new Date(rev.createdAt).getTime()).not.toBeNaN();
    }
    expect(view.snapshot.garments[0].lines[0].size).toBe('L');
  });

  it('serves an EARLIER revision snapshot when asked, with the full revision list intact', async () => {
    const { po, supplier } = await seedRevisedPo();

    const rev1 = await resolveSupplierPoViewByNumber(supplier.id, po.poNumber, 1);
    expect(rev1.revisionNumber).toBe(1);
    expect(rev1.snapshot.garments[0].lines[0].size).toBe('M');
    // The stepper needs the whole list no matter which revision is shown.
    expect(rev1.revisions.map((r) => r.revisionNumber)).toEqual([1, 2]);
    // Live PO state (status, dates) is unaffected by which snapshot is shown.
    expect(rev1.status).toBe('sent');

    const rev2 = await resolveSupplierPoViewByNumber(supplier.id, po.poNumber, 2);
    expect(rev2.revisionNumber).toBe(2);
    expect(rev2.snapshot.garments[0].lines[0].size).toBe('L');
  });

  it('throws revision_not_found for a revision that does not exist', async () => {
    const { po, supplier } = await seedRevisedPo();

    await expect(resolveSupplierPoViewByNumber(supplier.id, po.poNumber, 3)).rejects.toThrow(
      'revision_not_found',
    );
    await expect(resolveSupplierPoViewByNumber(supplier.id, po.poNumber, 0)).rejects.toThrow(
      'revision_not_found',
    );
  });

  it('the legacy token view carries the revision list too and always shows the latest', async () => {
    const { rawToken } = await seedRevisedPo();

    const view = await resolveSupplierPortalView(rawToken);
    expect(view.revisionNumber).toBe(2);
    expect(view.revisions.map((r) => r.revisionNumber)).toEqual([1, 2]);
    expect(view.snapshot.garments[0].lines[0].size).toBe('L');
  });
});

describe('updateSupplierPoStatusByNumber', () => {
  it('moves the PO and audits with the person\'s name — "Name (Supplier)"', async () => {
    const { po, orderId, supplier } = await seedPoWithToken();

    const result = await updateSupplierPoStatusByNumber(
      { id: supplier.id, name: supplier.name },
      po.poNumber,
      'pre_production',
      'Ana',
    );
    expect(result).toEqual({ poId: po.id, poNumber: po.poNumber, status: 'pre_production' });

    const audits = await db.query.auditEvents.findMany({
      where: and(
        eq(schema.auditEvents.aggregateId, orderId),
        eq(schema.auditEvents.eventType, 'po.supplier_updated'),
      ),
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].actorEmail).toBe('Ana (Vast Apparel)');

    const supplierEvents = await db.query.domainEvents.findMany({
      where: and(
        eq(schema.domainEvents.aggregateId, orderId),
        eq(schema.domainEvents.eventType, 'po.supplier_updated'),
      ),
    });
    expect(supplierEvents[0].payload).toMatchObject({ actorLabel: 'Ana (Vast Apparel)' });
  });

  it('rejects statuses outside the supplier-safe subset', async () => {
    const { po, supplier } = await seedPoWithToken();
    await expect(
      // @ts-expect-error — runtime guard against out-of-union values.
      updateSupplierPoStatusByNumber({ id: supplier.id, name: supplier.name }, po.poNumber, 'confirmed', 'Ana'),
    ).rejects.toThrow('status_not_allowed');
  });

  it('answers po_not_found for another supplier\'s PO number', async () => {
    const { po } = await seedPoWithToken();
    const rival = await seedSupplier({ name: 'Goal Sports', supplierCode: 'GOAL' });

    await expect(
      updateSupplierPoStatusByNumber({ id: rival.id, name: rival.name }, po.poNumber, 'pre_production', 'Ana'),
    ).rejects.toThrow('po_not_found');
  });
});

describe('updateSupplierPoShipDate', () => {
  it('sets the date and audits po.ship_date_changed with from→to and the named actor', async () => {
    const { po, orderId, supplier } = await seedPoWithToken();

    const first = await updateSupplierPoShipDate(
      { id: supplier.id, name: supplier.name },
      po.poNumber,
      '2026-10-01',
      'Ana',
    );
    expect(first).toEqual({ poId: po.id, poNumber: po.poNumber, expectedShipDate: '2026-10-01' });

    await updateSupplierPoShipDate(
      { id: supplier.id, name: supplier.name },
      po.poNumber,
      '2026-10-08',
      'Ana',
    );

    const row = await db.query.purchaseOrders.findFirst({
      where: eq(schema.purchaseOrders.id, po.id),
    });
    expect(row!.expectedShipDate).toBe('2026-10-08');

    const audits = await db.query.auditEvents.findMany({
      where: and(
        eq(schema.auditEvents.aggregateId, orderId),
        eq(schema.auditEvents.eventType, 'po.ship_date_changed'),
      ),
    });
    expect(audits).toHaveLength(2);
    expect(audits.map((a) => a.payload)).toEqual(
      expect.arrayContaining([
        { poId: po.id, poNumber: po.poNumber, from: null, to: '2026-10-01' },
        { poId: po.id, poNumber: po.poNumber, from: '2026-10-01', to: '2026-10-08' },
      ]),
    );
    expect(audits.every((a) => a.actorEmail === 'Ana (Vast Apparel)')).toBe(true);
  });

  it('locks the ship date once the PO reaches shipping (in_transit and beyond)', async () => {
    const { po, supplier } = await seedPoWithToken();
    await updatePurchaseOrderStatus(po.id, 'in_transit');

    await expect(
      updateSupplierPoShipDate({ id: supplier.id, name: supplier.name }, po.poNumber, '2026-10-01', 'Ana'),
    ).rejects.toThrow('locked_after_shipping');
  });

  it('answers po_not_found for another supplier\'s PO number', async () => {
    const { po } = await seedPoWithToken();
    const rival = await seedSupplier({ name: 'Goal Sports', supplierCode: 'GOAL' });

    await expect(
      updateSupplierPoShipDate({ id: rival.id, name: rival.name }, po.poNumber, '2026-10-01', 'Ana'),
    ).rejects.toThrow('po_not_found');
  });
});

describe('addSupplierCommentByNumber', () => {
  it('labels the note with person, supplier, and PO number', async () => {
    const { po, orderId, supplier } = await seedPoWithToken();

    const note = await addSupplierCommentByNumber(
      { id: supplier.id, name: supplier.name },
      po.poNumber,
      'Fabric arrives Tuesday.',
      'Ana',
    );

    expect(note.authorKind).toBe('supplier');
    expect(note.visibility).toBe('shared');
    expect(note.authorLabel).toBe(`Ana (Vast Apparel, ${po.poNumber})`);

    const rows = await db.query.orderNotes.findMany({
      where: eq(schema.orderNotes.orderId, orderId),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].visibility).toBe('shared');
  });

  it('answers po_not_found for another supplier\'s PO number', async () => {
    const { po } = await seedPoWithToken();
    const rival = await seedSupplier({ name: 'Goal Sports', supplierCode: 'GOAL' });

    await expect(
      addSupplierCommentByNumber({ id: rival.id, name: rival.name }, po.poNumber, 'hello', 'Ana'),
    ).rejects.toThrow('po_not_found');
  });
});
