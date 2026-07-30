import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq, and } from 'drizzle-orm';

vi.mock('@/db', async () => {
  const { createTestDb } = await import('@/db/test-helpers');
  const schema = await import('@/db/schema');
  const { db } = await createTestDb();
  return { db, schema };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { createOrder, upsertSizingRows, deleteGarment } from '@/server/orders/service';
import { createOrderSchema } from '@/server/orders/contract';
import {
  createPurchaseOrder,
  getPurchaseOrder,
  getOrderProductionSummary,
  issueRevision,
  listPurchaseOrders,
  listRevisions,
  updatePurchaseOrder,
  updatePurchaseOrderStatus,
} from './service';

afterEach(async () => {
  await resetTestDb(db);
});

// Expected PO-number date segment for "now" (generatePoNumber uses new Date()).
function yymm() {
  const now = new Date();
  return `${String(now.getFullYear() % 100).padStart(2, '0')}${String(now.getMonth() + 1).padStart(2, '0')}`;
}

async function seedSupplier(overrides: Partial<typeof schema.suppliers.$inferInsert> = {}) {
  const [supplier] = await db
    .insert(schema.suppliers)
    .values({ name: 'Vast Apparel', supplierCode: 'VA', ...overrides })
    .returning();
  return supplier;
}

async function seedStaffUser(email = 'sam@example.com') {
  const [user] = await db
    .insert(schema.staffUsers)
    .values({ email, passwordHash: 'x', name: 'Sam Staff' })
    .returning();
  return user;
}

/** Order with two garments: Hoodie (2 sizing rows) + Shorts (1 sizing row). */
async function seedOrder(customerName = 'Jane Coach') {
  const created = await createOrder(
    createOrderSchema.parse({
      customer: { name: customerName, email: 'jane@example.com' },
      garments: [
        {
          name: 'Team Hoodie',
          fabrics: ['Cotton Fleece'],
          sizing: [
            { size: 'M', playerName: 'Alice', playerNumber: '7' },
            { size: 'L', playerName: 'Bob', playerNumber: '8' },
          ],
        },
        { name: 'Shorts', sizing: [{ size: 'S', playerName: 'Cara' }] },
      ],
    }),
  );
  const garments = await db.query.garments.findMany({
    where: eq(schema.garments.orderId, created.orderId),
    orderBy: (g, { asc }) => [asc(g.sortOrder)],
    with: { sizing: { orderBy: (s, { asc }) => [asc(s.sortOrder)] } },
  });
  return { orderId: created.orderId, orderNumber: created.orderNumber, garments };
}

describe('createPurchaseOrder', () => {
  it('creates the PO with a rev-1 live snapshot, outbox event, and audit row', async () => {
    const supplier = await seedSupplier();
    const staff = await seedStaffUser();
    const { orderId, orderNumber, garments } = await seedOrder('Jane Coach!');
    const hoodie = garments[0];

    const po = await createPurchaseOrder(
      {
        orderId,
        supplierId: supplier.id,
        garmentIds: [hoodie.id],
        deadlineDate: '2026-09-01',
        notes: 'rush',
      },
      { actorStaffUserId: staff.id, actorEmail: staff.email },
    );

    expect(po.poNumber).toMatch(new RegExp(`^PO-${yymm()}-VA01-JANECOACH$`));
    expect(po.status).toBe('draft');
    expect(po.currentRevisionNumber).toBe(1);
    expect(po.createdBy).toBe(staff.id);
    expect(po.deadlineDate).toBe('2026-09-01');

    // Rev 1: reason null, snapshot keyed by the REAL sizing-row uuids.
    expect(po.revision.revisionNumber).toBe(1);
    expect(po.revision.reason).toBeNull();
    expect(po.revision.snapshot.orderNumber).toBe(orderNumber);
    expect(po.revision.snapshot.garments).toHaveLength(1);
    expect(po.revision.snapshot.garments[0].garmentId).toBe(hoodie.id);
    expect(po.revision.snapshot.garments[0].lines.map((l) => l.sizingRowId)).toEqual(
      hoodie.sizing.map((r) => r.id),
    );
    expect(po.revision.snapshot.garments[0].lines[0]).toMatchObject({
      size: 'M',
      playerName: 'Alice',
      playerNumber: '7',
    });

    const events = await db.query.domainEvents.findMany({
      where: and(
        eq(schema.domainEvents.aggregateId, orderId),
        eq(schema.domainEvents.eventType, 'po.created'),
      ),
    });
    expect(events).toHaveLength(1);
    expect(events[0].payload).toEqual({
      poId: po.id,
      poNumber: po.poNumber,
      supplierId: supplier.id,
      supplierName: supplier.name,
    });

    const audits = await db.query.auditEvents.findMany({
      where: and(
        eq(schema.auditEvents.aggregateId, orderId),
        eq(schema.auditEvents.eventType, 'po.created'),
      ),
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].actorEmail).toBe(staff.email);
    expect(audits[0].payload).toEqual({ poId: po.id, poNumber: po.poNumber });
  });

  it('increments NN for the same supplier and month', async () => {
    const supplier = await seedSupplier();
    const { orderId, garments } = await seedOrder();

    const first = await createPurchaseOrder({
      orderId,
      supplierId: supplier.id,
      garmentIds: [garments[0].id],
    });
    const second = await createPurchaseOrder({
      orderId,
      supplierId: supplier.id,
      garmentIds: [garments[1].id],
    });

    expect(first.poNumber).toContain(`-VA01-`);
    expect(second.poNumber).toContain(`-VA02-`);
  });

  it('rejects garment ids that belong to a different order (409)', async () => {
    const supplier = await seedSupplier();
    const { orderId } = await seedOrder();
    const other = await seedOrder('Other Club');

    await expect(
      createPurchaseOrder({
        orderId,
        supplierId: supplier.id,
        garmentIds: [other.garments[0].id],
      }),
    ).rejects.toThrow('One or more garments do not belong to this order');
  });

  it('rejects a selection with no sizing rows (409)', async () => {
    const supplier = await seedSupplier();
    const created = await createOrder(
      createOrderSchema.parse({
        customer: { name: 'Jane', email: 'jane@example.com' },
        garments: [{ name: 'Empty Garment' }],
      }),
    );
    const garment = await db.query.garments.findFirst({
      where: eq(schema.garments.orderId, created.orderId),
    });

    await expect(
      createPurchaseOrder({
        orderId: created.orderId,
        supplierId: supplier.id,
        garmentIds: [garment!.id],
      }),
    ).rejects.toThrow('Selected garments have no sizing rows');
  });

  it('rejects an inactive supplier (409) and unknown order/supplier (404)', async () => {
    const inactive = await seedSupplier({ name: 'Retired Co', supplierCode: 'RC', isActive: false });
    const { orderId, garments } = await seedOrder();

    await expect(
      createPurchaseOrder({ orderId, supplierId: inactive.id, garmentIds: [garments[0].id] }),
    ).rejects.toThrow('Supplier is inactive');

    const ghost = '00000000-0000-4000-8000-000000000000';
    await expect(
      createPurchaseOrder({ orderId: ghost, supplierId: inactive.id, garmentIds: [garments[0].id] }),
    ).rejects.toThrow('Order not found');
    await expect(
      createPurchaseOrder({ orderId, supplierId: ghost, garmentIds: [garments[0].id] }),
    ).rejects.toThrow('Supplier not found');
  });
});

describe('updatePurchaseOrderStatus', () => {
  async function seedPo() {
    const supplier = await seedSupplier();
    const { orderId, garments } = await seedOrder();
    const po = await createPurchaseOrder({
      orderId,
      supplierId: supplier.id,
      garmentIds: [garments[0].id],
    });
    return { po, orderId };
  }

  it('moves forward and stamps sentAt/receivedAt', async () => {
    const { po, orderId } = await seedPo();

    const sent = await updatePurchaseOrderStatus(po.id, 'sent', { actorEmail: 'sam@example.com' });
    expect(sent.status).toBe('sent');
    expect(sent.sentAt).toBeInstanceOf(Date);

    const received = await updatePurchaseOrderStatus(po.id, 'received');
    expect(received.status).toBe('received');
    expect(received.receivedAt).toBeInstanceOf(Date);
    expect(received.sentAt).toEqual(sent.sentAt); // first-send stamp survives

    const events = await db.query.domainEvents.findMany({
      where: and(
        eq(schema.domainEvents.aggregateId, orderId),
        eq(schema.domainEvents.eventType, 'po.status_changed'),
      ),
    });
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.payload)).toEqual(
      expect.arrayContaining([
        { poId: po.id, poNumber: po.poNumber, from: 'draft', to: 'sent' },
        { poId: po.id, poNumber: po.poNumber, from: 'sent', to: 'received' },
      ]),
    );

    const audits = await db.query.auditEvents.findMany({
      where: and(
        eq(schema.auditEvents.aggregateId, orderId),
        eq(schema.auditEvents.eventType, 'po.status_changed'),
      ),
    });
    expect(audits).toHaveLength(2);
  });

  it('rejects an illegal transition with a 409-mapped ConflictError', async () => {
    const { po } = await seedPo();
    await updatePurchaseOrderStatus(po.id, 'in_production');

    await expect(updatePurchaseOrderStatus(po.id, 'cancelled')).rejects.toThrow(
      'Cannot move a in_production purchase order to cancelled',
    );
    await expect(updatePurchaseOrderStatus(po.id, 'draft')).rejects.toThrow(
      'Cannot move a in_production purchase order to draft',
    );
  });

  it('emits po.cancelled alongside po.status_changed when cancelling', async () => {
    const { po, orderId } = await seedPo();
    await updatePurchaseOrderStatus(po.id, 'cancelled');

    const cancelled = await db.query.domainEvents.findMany({
      where: and(
        eq(schema.domainEvents.aggregateId, orderId),
        eq(schema.domainEvents.eventType, 'po.cancelled'),
      ),
    });
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0].payload).toEqual({ poId: po.id, poNumber: po.poNumber });
  });
});

describe('issueRevision', () => {
  it('bumps the revision, records the reason, and snapshots the edited sizing', async () => {
    const supplier = await seedSupplier();
    const staff = await seedStaffUser();
    const { orderId, garments } = await seedOrder();
    const hoodie = garments[0];
    const po = await createPurchaseOrder({
      orderId,
      supplierId: supplier.id,
      garmentIds: [hoodie.id],
    });

    // Staff edit: change Alice's size, keep row ids stable.
    await upsertSizingRows(
      hoodie.id,
      hoodie.sizing.map((r) => ({
        id: r.id,
        size: r.playerName === 'Alice' ? 'XL' : r.size,
        playerName: r.playerName,
        playerNumber: r.playerNumber,
      })),
    );

    const revision = await issueRevision(
      po.id,
      { reason: 'Customer resized Alice' },
      { actorStaffUserId: staff.id, actorEmail: staff.email },
    );

    expect(revision.revisionNumber).toBe(2);
    expect(revision.reason).toBe('Customer resized Alice');
    const aliceLine = revision.snapshot.garments[0].lines.find((l) => l.playerName === 'Alice');
    expect(aliceLine!.size).toBe('XL');
    expect(aliceLine!.sizingRowId).toBe(hoodie.sizing[0].id);

    const updated = await getPurchaseOrder(po.id);
    expect(updated.currentRevisionNumber).toBe(2);
    expect(updated.revisions.map((r) => r.revisionNumber)).toEqual([2, 1]);

    const events = await db.query.domainEvents.findMany({
      where: and(
        eq(schema.domainEvents.aggregateId, orderId),
        eq(schema.domainEvents.eventType, 'po.revised'),
      ),
    });
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({ poId: po.id, revisionNumber: 2, reason: 'Customer resized Alice' });
  });

  it('defaults the scope to the previous revision minus removed garments; supports override', async () => {
    const supplier = await seedSupplier();
    const { orderId, garments } = await seedOrder();
    const po = await createPurchaseOrder({
      orderId,
      supplierId: supplier.id,
      garmentIds: [garments[0].id, garments[1].id],
    });

    await deleteGarment(garments[1].id);
    const rev2 = await issueRevision(po.id, { reason: 'shorts dropped from order' });
    expect(rev2.snapshot.garments.map((g) => g.garmentId)).toEqual([garments[0].id]);

    const rev3 = await issueRevision(po.id, {
      reason: 'narrow to hoodie explicitly',
      garmentIds: [garments[0].id],
    });
    expect(rev3.revisionNumber).toBe(3);
    expect(rev3.snapshot.garments.map((g) => g.garmentId)).toEqual([garments[0].id]);
  });

  it('rejects revising a cancelled or completed PO', async () => {
    const supplier = await seedSupplier();
    const { orderId, garments } = await seedOrder();
    const po = await createPurchaseOrder({
      orderId,
      supplierId: supplier.id,
      garmentIds: [garments[0].id],
    });
    await updatePurchaseOrderStatus(po.id, 'cancelled');

    await expect(issueRevision(po.id, { reason: 'nope' })).rejects.toThrow(
      'Cannot revise a cancelled purchase order',
    );
  });
});

describe('updatePurchaseOrder', () => {
  it('patches dates/notes and audits po.updated on the order aggregate', async () => {
    const supplier = await seedSupplier();
    const { orderId, garments } = await seedOrder();
    const po = await createPurchaseOrder({
      orderId,
      supplierId: supplier.id,
      garmentIds: [garments[0].id],
      notes: 'original',
    });

    const updated = await updatePurchaseOrder(
      po.id,
      { expectedShipDate: '2026-10-15', notes: null },
      { actorEmail: 'sam@example.com' },
    );
    expect(updated.expectedShipDate).toBe('2026-10-15');
    expect(updated.notes).toBeNull();

    const audits = await db.query.auditEvents.findMany({
      where: and(
        eq(schema.auditEvents.aggregateId, orderId),
        eq(schema.auditEvents.eventType, 'po.updated'),
      ),
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].payload).toEqual({
      poId: po.id,
      poNumber: po.poNumber,
      fields: ['expectedShipDate', 'notes'],
    });
  });
});

describe('getOrderProductionSummary', () => {
  it('reports coverage and post-edit variance against the latest snapshot', async () => {
    const supplier = await seedSupplier();
    const { orderId, garments } = await seedOrder();
    const [hoodie, shorts] = garments;
    const po = await createPurchaseOrder({
      orderId,
      supplierId: supplier.id,
      garmentIds: [hoodie.id],
    });

    const before = await getOrderProductionSummary(orderId);
    expect(before.coverage.totalRows).toBe(3);
    expect(before.coverage.coveredRows).toBe(2);
    expect(before.coverage.percentage).toBe(67);
    expect(before.coverage.uncoveredByGarment).toEqual({ [shorts.id]: 1 });
    expect(before.coverage.rowToPos[hoodie.sizing[0].id]).toEqual([
      { poId: po.id, poNumber: po.poNumber },
    ]);
    expect(before.purchaseOrders).toHaveLength(1);
    expect(before.purchaseOrders[0].variance.hasVariance).toBe(false);
    expect(before.purchaseOrders[0].varianceCounts).toEqual({ added: 0, modified: 0, removed: 0 });

    // Edit a covered row + add a new one → modified + added variance.
    await upsertSizingRows(hoodie.id, [
      { id: hoodie.sizing[0].id, size: '2XL', playerName: 'Alice', playerNumber: '7' },
      { id: hoodie.sizing[1].id, size: 'L', playerName: 'Bob', playerNumber: '8' },
      { size: 'S', playerName: 'Dana' },
    ]);

    const after = await getOrderProductionSummary(orderId);
    const summary = after.purchaseOrders[0];
    expect(summary.variance.hasVariance).toBe(true);
    expect(summary.varianceCounts).toEqual({ added: 1, modified: 1, removed: 0 });
    const hoodieVariance = summary.variance.garments.find((g) => g.garmentId === hoodie.id);
    expect(hoodieVariance!.status).toBe('modified');
    expect(hoodieVariance!.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sizingRowId: hoodie.sizing[0].id,
          change: 'modified',
          fieldChanges: [{ field: 'size', from: 'M', to: '2XL' }],
        }),
        expect.objectContaining({ change: 'added' }),
      ]),
    );

    // The new (added) row is not in any snapshot → coverage drops.
    expect(after.coverage.totalRows).toBe(4);
    expect(after.coverage.coveredRows).toBe(2);

    // Cancelling the PO uncovers everything.
    await updatePurchaseOrderStatus(po.id, 'cancelled');
    const cancelled = await getOrderProductionSummary(orderId);
    expect(cancelled.coverage.coveredRows).toBe(0);
  });

  it('throws NotFound for an unknown order', async () => {
    await expect(
      getOrderProductionSummary('00000000-0000-4000-8000-000000000000'),
    ).rejects.toThrow('Order not found');
  });
});

describe('listPurchaseOrders / listRevisions', () => {
  it('filters by status, supplier, and search', async () => {
    const va = await seedSupplier();
    const nw = await seedSupplier({ name: 'Northwind Textiles', supplierCode: 'NW' });
    const first = await seedOrder('Jane Coach');
    const second = await seedOrder('Rovers FC');

    const poA = await createPurchaseOrder({
      orderId: first.orderId,
      supplierId: va.id,
      garmentIds: [first.garments[0].id],
    });
    const poB = await createPurchaseOrder({
      orderId: second.orderId,
      supplierId: nw.id,
      garmentIds: [second.garments[0].id],
    });
    await updatePurchaseOrderStatus(poB.id, 'sent');

    const all = await listPurchaseOrders();
    expect(all).toHaveLength(2);
    expect(all[0].supplierName).toBeDefined();
    expect(all[0].orderNumber).toBeDefined();

    const sentOnly = await listPurchaseOrders({ status: 'sent' });
    expect(sentOnly.map((p) => p.id)).toEqual([poB.id]);

    const bySupplier = await listPurchaseOrders({ supplierId: va.id });
    expect(bySupplier.map((p) => p.id)).toEqual([poA.id]);

    const byCustomer = await listPurchaseOrders({ search: 'rovers' });
    expect(byCustomer.map((p) => p.id)).toEqual([poB.id]);

    const byPoNumber = await listPurchaseOrders({ search: poA.poNumber });
    expect(byPoNumber.map((p) => p.id)).toEqual([poA.id]);
  });

  it('listRevisions returns newest first and 404s on unknown POs', async () => {
    const supplier = await seedSupplier();
    const { orderId, garments } = await seedOrder();
    const po = await createPurchaseOrder({
      orderId,
      supplierId: supplier.id,
      garmentIds: [garments[0].id],
    });
    await issueRevision(po.id, { reason: 'tweak' });

    const revisions = await listRevisions(po.id);
    expect(revisions.map((r) => r.revisionNumber)).toEqual([2, 1]);

    await expect(listRevisions('00000000-0000-4000-8000-000000000000')).rejects.toThrow(
      'Purchase order not found',
    );
  });
});

/**
 * What the factory is allowed to see. These tests exist because the separation
 * is a convention, not something the types enforce: a stray `?? order.deadlineDate`
 * or a helpful prefill in the create modal would leak confidential commercial
 * detail to a supplier and nothing else would catch it.
 */
describe('factory-facing data boundary', () => {
  /** An order carrying every field that must NOT reach a supplier. */
  async function seedConfidentialOrder() {
    const created = await createOrder(
      createOrderSchema.parse({
        customer: {
          name: 'Jane Coach',
          email: 'jane@example.com',
          clubName: 'Confidential Club',
        },
        // What the CUSTOMER was promised.
        deadlineDate: '2026-09-30',
        orderValue: { amount: 4200, currency: 'NZD' },
        generalNotes: 'customer-facing note',
        garments: [{ name: 'Jersey', sizing: [{ size: 'M', playerName: 'Alex' }] }],
      }),
    );
    const garments = await db.query.garments.findMany({
      where: eq(schema.garments.orderId, created.orderId),
    });
    return { orderId: created.orderId, garmentId: garments[0].id };
  }

  it('never derives the PO deadline from the customer deadline', async () => {
    const supplier = await seedSupplier();
    const { orderId, garmentId } = await seedConfidentialOrder();

    const po = await createPurchaseOrder({
      orderId,
      supplierId: supplier.id,
      garmentIds: [garmentId],
      // Staff deliberately did not set a factory deadline.
    });

    expect(po.deadlineDate).toBeNull();
  });

  it('keeps the two deadlines independent when both are set', async () => {
    const supplier = await seedSupplier();
    const { orderId, garmentId } = await seedConfidentialOrder();

    const po = await createPurchaseOrder({
      orderId,
      supplierId: supplier.id,
      garmentIds: [garmentId],
      deadlineDate: '2026-08-15', // the factory works to its own, earlier date
    });

    expect(po.deadlineDate).toBe('2026-08-15');
  });

  /**
   * An allowlist, not a sample. Adding a field to the snapshot should fail here
   * until someone consciously decides the supplier may see it.
   */
  it('snapshots exactly the agreed fields and nothing else', async () => {
    const supplier = await seedSupplier();
    const { orderId, garmentId } = await seedConfidentialOrder();

    const po = await createPurchaseOrder({
      orderId,
      supplierId: supplier.id,
      garmentIds: [garmentId],
    });

    const snapshot = po.revision.snapshot;
    expect(Object.keys(snapshot).sort()).toEqual([
      'assets',
      // Deliberate addition (2026-07-31): which pre-production checks were
      // confirmed before issue, and by whom. Staff emails reaching the
      // supplier document is the point — requested as "who checked it, who
      // double-checked it" on the production order.
      'checks',
      'garments',
      'orderNumber',
      'preparedByEmail',
      'reprintOfOrderNumber',
    ]);
    expect(Object.keys(snapshot.garments[0]).sort()).toEqual([
      'fabrics',
      'garmentId',
      'garmentTypeId',
      'garmentTypeName',
      'lines',
      'name',
      'notes',
      'selectedFabrics',
      'selectedOptions',
      // Deliberate addition (2026-07-30): the reference charts the factory
      // cuts to. Carries chart id/name/storageKey only — nothing customer-
      // identifying.
      'sizeCharts',
      'sizingColumns',
    ]);

    // Spot-check the specific things that must never be in there.
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('Confidential Club');
    expect(serialized).not.toContain('2026-09-30');
    expect(serialized).not.toContain('4200');
    expect(serialized).not.toContain('customer-facing note');
    expect(serialized).not.toContain('jane@example.com');
  });
});
