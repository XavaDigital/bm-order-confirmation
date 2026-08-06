import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq, and } from 'drizzle-orm';

vi.mock('@/db', async () => {
  const { createTestDb } = await import('@/db/test-helpers');
  const schema = await import('@/db/schema');
  const { db } = await createTestDb();
  return { db, schema };
});

// Capture the supplier email instead of hitting SMTP — sendPurchaseOrder's
// tests assert on what would have been sent (portal URL, recipient).
const sendSupplierPoEmailMock = vi.hoisted(() =>
  vi.fn(async (_params: Record<string, unknown>) => {}),
);
vi.mock('@/lib/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email')>()),
  sendSupplierPoEmail: sendSupplierPoEmailMock,
}));

// Fake file contents keyed by storage key, instead of hitting real storage —
// same shape used for getSignedUrl elsewhere in this file (real impl kept,
// only getFileBuffer is faked, since signPoSnapshotMedia already tolerates a
// failing getSignedUrl by catching to null).
const defaultGetFileBuffer = async (key: string) => Buffer.from(`content:${key}`);
const getFileBufferMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/storage')>()),
  getFileBuffer: getFileBufferMock,
}));

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { createOrder, updateOrder, upsertSizingRows, deleteGarment } from '@/server/orders/service';
import { createOrderSchema } from '@/server/orders/contract';
import {
  createPurchaseOrder,
  getPurchaseOrder,
  getOrderProductionSummary,
  issueRevision,
  listPurchaseOrders,
  listRevisions,
  sendPurchaseOrder,
  updatePurchaseOrder,
  updatePurchaseOrderStatus,
} from './service';

getFileBufferMock.mockImplementation(defaultGetFileBuffer);

afterEach(async () => {
  await resetTestDb(db);
  sendSupplierPoEmailMock.mockClear();
  getFileBufferMock.mockReset();
  getFileBufferMock.mockImplementation(defaultGetFileBuffer);
});

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
  // Two chart sets (David, 2026-08-06): the factory snapshot prefers
  // production charts and falls back to the customer set — also proves
  // loadOrderGarments actually selects the kind column.
  it('snapshots production charts when linked, falling back to customer charts otherwise', async () => {
    const supplier = await seedSupplier();
    const { orderId, garments } = await seedOrder();
    const [hoodie, shorts] = garments;

    const [customerChart] = await db
      .insert(schema.sizeCharts)
      .values({ name: 'Customer Chart', kind: 'customer', storageKey: 'size-charts/c.png' })
      .returning();
    const [productionChart] = await db
      .insert(schema.sizeCharts)
      .values({ name: 'Factory Chart', kind: 'production', storageKey: 'size-charts/p.png' })
      .returning();

    // Hoodie has both kinds; shorts has only the customer chart.
    await db.insert(schema.garmentSizeChartLinks).values([
      { garmentId: hoodie.id, sizeChartId: customerChart.id },
      { garmentId: hoodie.id, sizeChartId: productionChart.id },
      { garmentId: shorts.id, sizeChartId: customerChart.id },
    ]);

    const po = await createPurchaseOrder(
      { orderId, supplierId: supplier.id, garmentIds: [hoodie.id, shorts.id] },
      {},
    );

    const [hoodieSnap, shortsSnap] = po.revision.snapshot.garments;
    expect(hoodieSnap.sizeCharts).toEqual([
      { id: productionChart.id, name: 'Factory Chart', storageKey: 'size-charts/p.png', kind: 'production' },
    ]);
    expect(shortsSnap.sizeCharts).toEqual([
      { id: customerChart.id, name: 'Customer Chart', storageKey: 'size-charts/c.png', kind: 'customer' },
    ]);
  });

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
        notes: 'rush',
      },
      { actorStaffUserId: staff.id, actorEmail: staff.email },
    );

    // {CODE}{seq} format (David, 2026-08-05) — first PO for this supplier.
    expect(po.poNumber).toBe('VA1');
    expect(po.status).toBe('draft');
    expect(po.currentRevisionNumber).toBe(1);
    expect(po.createdBy).toBe(staff.id);
    // The order has no customer deadline, so the mirrored PO deadline is null.
    expect(po.deadlineDate).toBeNull();

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

  it('increments the per-supplier sequence', async () => {
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

    expect(first.poNumber).toBe('VA1');
    expect(second.poNumber).toBe('VA2');
  });

  it('numbers each supplier independently, and sequences survive across months', async () => {
    const dy = await seedSupplier({ name: 'Dynasty', supplierCode: 'DY' });
    const goal = await seedSupplier({ name: 'Goal Sports', supplierCode: 'GOAL' });
    const { orderId, garments } = await seedOrder();

    const dyFirst = await createPurchaseOrder({
      orderId,
      supplierId: dy.id,
      garmentIds: [garments[0].id],
    });
    const goalFirst = await createPurchaseOrder({
      orderId,
      supplierId: goal.id,
      garmentIds: [garments[1].id],
    });
    // Each supplier counts alone — DY1 and GOAL1 coexist.
    expect(dyFirst.poNumber).toBe('DY1');
    expect(goalFirst.poNumber).toBe('GOAL1');

    // The sequence is the supplier row's counter, not a month bucket — a
    // month (even a year) rollover must not reset it to 1.
    vi.useFakeTimers({ now: new Date('2027-01-15T00:00:00Z'), toFake: ['Date'] });
    try {
      const dySecond = await createPurchaseOrder({
        orderId,
        supplierId: dy.id,
        garmentIds: [garments[1].id],
      });
      expect(dySecond.poNumber).toBe('DY2');
    } finally {
      vi.useRealTimers();
    }
  });

  it('derives a 2-char fallback code when the supplier has none stored', async () => {
    const noCode = await seedSupplier({ name: 'Vast Apparel', supplierCode: null });
    const { orderId, garments } = await seedOrder();

    const po = await createPurchaseOrder({
      orderId,
      supplierId: noCode.id,
      garmentIds: [garments[0].id],
    });
    expect(po.poNumber).toBe('VA1'); // first letters of the first two words
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

describe('sendPurchaseOrder', () => {
  const renderPdf = async () => Buffer.from('%PDF-fake');

  /** Tick every active 0041 pre-send checklist item — sends are gated on it. */
  async function satisfyPoChecklist(poId: string) {
    const items = await db.query.poChecklistItems.findMany({
      where: eq(schema.poChecklistItems.isActive, true),
    });
    if (items.length === 0) return;
    await db.insert(schema.poChecklistCompletions).values(
      items.map((item) => ({ poId, itemId: item.id, checkedByEmail: 'seed@example.com' })),
    );
  }

  async function seedSendablePo() {
    const supplier = await seedSupplier({ email: 'factory@example.com' });
    const { orderId, garments } = await seedOrder();
    const po = await createPurchaseOrder({
      orderId,
      supplierId: supplier.id,
      garmentIds: [garments[0].id],
    });
    await satisfyPoChecklist(po.id);
    // Open the po_send gate: deactivate the migration-seeded order checklist
    // tasks (artwork/sizing/fabric). resetTestDb restores them per test.
    await db.update(schema.workflowStageTasks).set({ isActive: false });
    return { po, orderId, supplier };
  }

  it('refuses to send a draft — internal approval comes first (409)', async () => {
    const { po } = await seedSendablePo();

    await expect(sendPurchaseOrder(po.id, {}, renderPdf)).rejects.toThrow(
      'Move the purchase order to Review before sending it',
    );
    expect(sendSupplierPoEmailMock).not.toHaveBeenCalled();
  });

  it('sends an approved PO: portal URL in the email, approved → sent with sentAt', async () => {
    const { po, orderId } = await seedSendablePo();
    await updatePurchaseOrderStatus(po.id, 'approved');

    const result = await sendPurchaseOrder(po.id, { actorEmail: 'sam@example.com' }, renderPdf);
    expect(result).toEqual({
      poNumber: po.poNumber,
      to: 'factory@example.com',
      attachmentSummary: { images: 0, fonts: 0, sizeCharts: 0, sizeReduced: false },
    });

    expect(sendSupplierPoEmailMock).toHaveBeenCalledTimes(1);
    const emailArgs = sendSupplierPoEmailMock.mock.calls[0][0];
    expect(emailArgs.to).toBe('factory@example.com');
    // The pretty deterministic per-PO URL — no token minting anymore.
    expect(emailArgs.portalUrl).toBe(`http://localhost:3000/supplier/VA/po/${po.poNumber}`);
    // The xlsx twin of the PDF now rides every send (AUTO_ORDER_EMAIL_PLAN.md).
    expect(emailArgs.xlsx).toBeInstanceOf(Buffer);
    expect((emailArgs.xlsx as Buffer).length).toBeGreaterThan(0);
    expect(emailArgs.sizeReduced).toBe(false);

    const updated = await db.query.purchaseOrders.findFirst({
      where: eq(schema.purchaseOrders.id, po.id),
    });
    expect(updated!.status).toBe('sent');
    expect(updated!.sentAt).toBeInstanceOf(Date);

    // No supplier-access token row is minted by a send anymore.
    const accessRows = await db
      .select()
      .from(schema.poSupplierAccess)
      .where(eq(schema.poSupplierAccess.purchaseOrderId, po.id));
    expect(accessRows).toHaveLength(0);

    const sentEvents = await db.query.domainEvents.findMany({
      where: and(
        eq(schema.domainEvents.aggregateId, orderId),
        eq(schema.domainEvents.eventType, 'po.sent'),
      ),
    });
    expect(sentEvents).toHaveLength(1);
    expect(sentEvents[0].payload).toMatchObject({ poId: po.id, to: 'factory@example.com' });
  });

  it('resending a sent PO leaves the status untouched; terminal states refuse', async () => {
    const { po } = await seedSendablePo();
    await updatePurchaseOrderStatus(po.id, 'approved');
    await sendPurchaseOrder(po.id, {}, renderPdf);
    await sendPurchaseOrder(po.id, {}, renderPdf); // resend after a revision is legal

    expect(sendSupplierPoEmailMock).toHaveBeenCalledTimes(2);
    const updated = await db.query.purchaseOrders.findFirst({
      where: eq(schema.purchaseOrders.id, po.id),
    });
    expect(updated!.status).toBe('sent');

    await updatePurchaseOrderStatus(po.id, 'received');
    await expect(sendPurchaseOrder(po.id, {}, renderPdf)).rejects.toThrow(
      'Cannot send a received purchase order',
    );
  });
});

// AUTO_ORDER_EMAIL_PLAN.md Phase 1 — the fuller attachment set on every send.
describe('sendPurchaseOrder — attachments', () => {
  const renderPdf = async () => Buffer.from('%PDF-fake');

  async function seedSendablePoWithFiles() {
    const supplier = await seedSupplier({ email: 'factory@example.com' });
    const { orderId, garments } = await seedOrder();
    const hoodie = garments[0];

    await db.insert(schema.mockupImages).values({
      garmentId: hoodie.id,
      storageKey: 'mockups/hoodie-front-full.png',
      thumbnailStorageKey: 'mockups/hoodie-front-thumb.png',
      caption: 'Front',
    });
    await db.insert(schema.orderAssets).values({
      orderId,
      kind: 'font',
      name: 'Team Font',
      storageKey: 'fonts/team.ttf',
      includeOnPo: true,
    });

    const po = await createPurchaseOrder({
      orderId,
      supplierId: supplier.id,
      garmentIds: [hoodie.id],
    });
    // Tick the 0041 pre-send checklist + open the po_send gate, same as
    // seedSendablePo above.
    const items = await db.query.poChecklistItems.findMany({
      where: eq(schema.poChecklistItems.isActive, true),
    });
    if (items.length > 0) {
      await db.insert(schema.poChecklistCompletions).values(
        items.map((item) => ({ poId: po.id, itemId: item.id, checkedByEmail: 'seed@example.com' })),
      );
    }
    await db.update(schema.workflowStageTasks).set({ isActive: false });
    await updatePurchaseOrderStatus(po.id, 'approved');
    return { po, orderId, hoodie };
  }

  it('attaches the xlsx workbook, the garment image, and the font — full resolution', async () => {
    const { po } = await seedSendablePoWithFiles();

    const result = await sendPurchaseOrder(po.id, {}, renderPdf);
    expect(result.attachmentSummary).toEqual({
      images: 1,
      fonts: 1,
      sizeCharts: 0,
      sizeReduced: false,
    });

    expect(getFileBufferMock).toHaveBeenCalledWith('mockups/hoodie-front-full.png');
    expect(getFileBufferMock).not.toHaveBeenCalledWith('mockups/hoodie-front-thumb.png');

    const emailArgs = sendSupplierPoEmailMock.mock.calls[0][0];
    const extraAttachments = emailArgs.extraAttachments as { filename: string }[];
    expect(emailArgs.xlsx).toBeInstanceOf(Buffer);
    expect(emailArgs.sizeReduced).toBe(false);
    expect(extraAttachments).toHaveLength(2);
    expect(extraAttachments.map((a) => a.filename)).toEqual(
      expect.arrayContaining([expect.stringContaining('Front'), 'Team Font.ttf']),
    );
  });

  it('attaches an uploaded colour-book file to the supplier email', async () => {
    const supplier = await seedSupplier({ email: 'factory@example.com' });
    const { orderId, garments } = await seedOrder();
    const hoodie = garments[0];

    await db.insert(schema.orderAssets).values({
      orderId,
      kind: 'colour-book',
      name: 'Club Colours',
      storageKey: 'colour-books/club.pdf',
      includeOnPo: true,
    });

    const po = await createPurchaseOrder({
      orderId,
      supplierId: supplier.id,
      garmentIds: [hoodie.id],
    });
    await db.update(schema.workflowStageTasks).set({ isActive: false });
    await updatePurchaseOrderStatus(po.id, 'approved');

    const result = await sendPurchaseOrder(po.id, {}, renderPdf);

    const emailArgs = sendSupplierPoEmailMock.mock.calls[0][0];
    const extraAttachments = emailArgs.extraAttachments as { filename: string }[];
    expect(extraAttachments.map((a) => a.filename)).toContain('Club Colours.pdf');
    expect(result.attachmentSummary.fonts).toBe(1);
  });

  it('falls back to the thumbnail image when the full attachment set is over budget', async () => {
    const { po } = await seedSendablePoWithFiles();

    // One oversized "full-res" image is enough to blow the budget on its own;
    // everything else (font, thumbnail) stays small.
    getFileBufferMock.mockImplementation(async (key: string) => {
      if (key.includes('front-full')) return Buffer.alloc(21 * 1024 * 1024);
      return defaultGetFileBuffer(key);
    });

    const result = await sendPurchaseOrder(po.id, {}, renderPdf);
    expect(result.attachmentSummary.sizeReduced).toBe(true);
    expect(result.attachmentSummary.images).toBe(1);

    expect(getFileBufferMock).toHaveBeenCalledWith('mockups/hoodie-front-full.png');
    expect(getFileBufferMock).toHaveBeenCalledWith('mockups/hoodie-front-thumb.png');

    const emailArgs = sendSupplierPoEmailMock.mock.calls[0][0];
    expect(emailArgs.sizeReduced).toBe(true);
  });

  it('blocks the send when a garment image is referenced but missing from storage', async () => {
    const { po } = await seedSendablePoWithFiles();

    getFileBufferMock.mockImplementation(async (key: string) => {
      if (key.includes('front-full')) throw new Error('NoSuchKey');
      return defaultGetFileBuffer(key);
    });

    await expect(sendPurchaseOrder(po.id, {}, renderPdf)).rejects.toThrow(
      /re-upload before sending/,
    );
    expect(sendSupplierPoEmailMock).not.toHaveBeenCalled();
  });

  it('tells staff to issue a revision when the live order has replacement mock-ups', async () => {
    const { po, hoodie } = await seedSendablePoWithFiles();

    await db.delete(schema.mockupImages).where(eq(schema.mockupImages.garmentId, hoodie.id));
    await db.insert(schema.mockupImages).values({
      garmentId: hoodie.id,
      storageKey: 'mockups/hoodie-front-replacement.png',
      thumbnailStorageKey: null,
      caption: 'Front v2',
    });

    getFileBufferMock.mockImplementation(async (key: string) => {
      if (key.includes('front-full')) throw new Error('NoSuchKey');
      return defaultGetFileBuffer(key);
    });

    await expect(sendPurchaseOrder(po.id, {}, renderPdf)).rejects.toThrow(
      /issue a revision before sending/,
    );
    expect(sendSupplierPoEmailMock).not.toHaveBeenCalled();
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

  it('audits po.ship_date_changed with from→to when the expected ship date moves', async () => {
    const supplier = await seedSupplier();
    const { orderId, garments } = await seedOrder();
    const po = await createPurchaseOrder({
      orderId,
      supplierId: supplier.id,
      garmentIds: [garments[0].id],
      expectedShipDate: '2026-10-01',
    });

    await updatePurchaseOrder(
      po.id,
      { expectedShipDate: '2026-10-20' },
      { actorEmail: 'sam@example.com' },
    );
    // A notes-only patch must NOT add a ship-date row.
    await updatePurchaseOrder(po.id, { notes: 'unrelated' }, { actorEmail: 'sam@example.com' });

    const audits = await db.query.auditEvents.findMany({
      where: and(
        eq(schema.auditEvents.aggregateId, orderId),
        eq(schema.auditEvents.eventType, 'po.ship_date_changed'),
      ),
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].payload).toEqual({
      poId: po.id,
      poNumber: po.poNumber,
      from: '2026-10-01',
      to: '2026-10-20',
    });
    expect(audits[0].actorEmail).toBe('sam@example.com');
  });
});

describe('getPurchaseOrder', () => {
  it('serves the portal URL, the PO history, and the order deadline', async () => {
    const supplier = await seedSupplier();
    const created = await createOrder(
      createOrderSchema.parse({
        customer: { name: 'Jane Coach', email: 'jane@example.com' },
        deadlineDate: '2026-09-30',
        garments: [{ name: 'Jersey', sizing: [{ size: 'M' }] }],
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
    await updatePurchaseOrderStatus(po.id, 'approved', { actorEmail: 'sam@example.com' });

    const detail = await getPurchaseOrder(po.id);
    expect(detail.portalUrl).toBe(`http://localhost:3000/supplier/VA/po/${po.poNumber}`);
    // The order block carries the LIVE customer deadline for the admin page.
    expect(detail.order.deadlineDate).toBe('2026-09-30');
    // History: audit rows filtered to this PO (created + status change).
    expect(detail.history.length).toBeGreaterThanOrEqual(2);
    expect(detail.history.map((h) => h.eventType)).toEqual(
      expect.arrayContaining(['po.created', 'po.status_changed']),
    );
    const statusRow = detail.history.find((h) => h.eventType === 'po.status_changed')!;
    expect(statusRow.payload).toMatchObject({ poId: po.id, from: 'draft', to: 'approved' });
    expect(statusRow.actorEmail).toBe('sam@example.com');
    expect(detail.history.every((h) => (h.payload as { poId?: string }).poId === po.id)).toBe(true);
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
 * is a convention, not something the types enforce: the customer deadline now
 * DOES live on the PO row (David's 2026-08-05 reversal — it is internal
 * planning data), but it must still never reach the snapshot the supplier
 * documents are rendered from, and neither must any other commercial detail.
 */
describe('customer deadline and the factory-facing data boundary', () => {
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

  it('stamps the customer deadline onto the PO at create (2026-08-05 reversal)', async () => {
    const supplier = await seedSupplier();
    const { orderId, garmentId } = await seedConfidentialOrder();

    const po = await createPurchaseOrder({
      orderId,
      supplierId: supplier.id,
      garmentIds: [garmentId],
    });

    expect(po.deadlineDate).toBe('2026-09-30');
  });

  it('re-syncs every PO when the order deadline moves, and clears when it clears', async () => {
    const supplier = await seedSupplier();
    const { orderId, garmentId } = await seedConfidentialOrder();

    const po = await createPurchaseOrder({
      orderId,
      supplierId: supplier.id,
      garmentIds: [garmentId],
    });
    expect(po.deadlineDate).toBe('2026-09-30');

    await updateOrder(orderId, { deadlineDate: '2026-10-15' }, { actorEmail: 'sam@example.com' });
    let row = await db.query.purchaseOrders.findFirst({
      where: eq(schema.purchaseOrders.id, po.id),
    });
    expect(row!.deadlineDate).toBe('2026-10-15');

    await updateOrder(orderId, { deadlineDate: null });
    row = await db.query.purchaseOrders.findFirst({
      where: eq(schema.purchaseOrders.id, po.id),
    });
    expect(row!.deadlineDate).toBeNull();
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
      // Deliberate addition (2026-08-05): garment mock-up images — the
      // supplier PO must show what the garment looks like. storageKey refs
      // only; signed per request, never durable URLs.
      'images',
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
