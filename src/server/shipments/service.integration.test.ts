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
import { createOrder } from '@/server/orders/service';
import { createOrderSchema } from '@/server/orders/contract';
import { createSupplier } from '@/server/suppliers/service';
import { createSupplierSchema } from '@/server/suppliers/contract';
import {
  createPurchaseOrder,
  getPurchaseOrder,
} from '@/server/purchase-orders/service';
import {
  attachPurchaseOrders,
  createShipment,
  detachPurchaseOrder,
  getShipment,
  listShipments,
  setShipmentStatus,
  updateShipment,
} from './service';

afterEach(async () => {
  await resetTestDb(db);
});

const GHOST = '00000000-0000-4000-8000-000000000000';

async function seedSupplier(overrides: Partial<{ name: string; supplierCode: string; isActive: boolean }> = {}) {
  return createSupplier(
    createSupplierSchema.parse({ name: 'Vast Apparel', supplierCode: 'VA', ...overrides }),
  );
}

async function seedStaffUser(email = 'sam@example.com') {
  const [user] = await db
    .insert(schema.staffUsers)
    .values({ email, passwordHash: 'x', name: 'Sam Staff' })
    .returning();
  return user;
}

/** An order with one sized garment + a PO for it against the given supplier. */
async function seedOrderWithPo(supplierId: string, customerName = 'Jane Coach') {
  const created = await createOrder(
    createOrderSchema.parse({
      customer: { name: customerName, email: 'jane@example.com' },
      garments: [
        { name: 'Team Hoodie', sizing: [{ size: 'M', playerName: 'Alice', playerNumber: '7' }] },
      ],
    }),
  );
  const garment = await db.query.garments.findFirst({
    where: eq(schema.garments.orderId, created.orderId),
  });
  const po = await createPurchaseOrder({
    orderId: created.orderId,
    supplierId,
    garmentIds: [garment!.id],
  });
  return { orderId: created.orderId, orderNumber: created.orderNumber, po };
}

describe('createShipment', () => {
  it('creates the shipment + junction rows and fans out events/audit to each PO parent order', async () => {
    const supplier = await seedSupplier();
    const staff = await seedStaffUser();
    const a = await seedOrderWithPo(supplier.id, 'Jane Coach');
    const b = await seedOrderWithPo(supplier.id, 'Rovers FC');

    const shipment = await createShipment(
      {
        supplierId: supplier.id,
        purchaseOrderIds: [a.po.id, b.po.id],
        nickname: 'July air freight',
        carrier: 'DHL',
        trackingNumber: 'DHL123',
        trackingUrl: 'https://track.dhl.example/DHL123',
        boxCount: 3,
        pieceCount: 41,
        shippingCost: 420.5,
        shippingCostCurrency: 'USD',
        etaDate: '2026-08-15',
        notes: 'two-club consolidated box',
      },
      { actorStaffUserId: staff.id, actorEmail: staff.email },
    );

    expect(shipment.status).toBe('pending');
    expect(shipment.nickname).toBe('July air freight');
    expect(shipment.shippingCost).toBe('420.50');
    expect(shipment.etaDate).toBe('2026-08-15');
    expect(shipment.createdBy).toBe(staff.id);
    expect(shipment.purchaseOrders.map((p) => p.id)).toEqual([a.po.id, b.po.id]);
    expect(shipment.purchaseOrders[0]).toMatchObject({
      poNumber: a.po.poNumber,
      orderId: a.orderId,
      orderNumber: a.orderNumber,
    });

    // One shipment.created outbox event + one audit row PER PO, each on that
    // PO's own parent order.
    for (const { orderId, po } of [a, b]) {
      const events = await db.query.domainEvents.findMany({
        where: and(
          eq(schema.domainEvents.aggregateId, orderId),
          eq(schema.domainEvents.eventType, 'shipment.created'),
        ),
      });
      expect(events).toHaveLength(1);
      expect(events[0].payload).toEqual({
        shipmentId: shipment.id,
        nickname: 'July air freight',
        carrier: 'DHL',
        poId: po.id,
        poNumber: po.poNumber,
      });

      const audits = await db.query.auditEvents.findMany({
        where: and(
          eq(schema.auditEvents.aggregateId, orderId),
          eq(schema.auditEvents.eventType, 'shipment.created'),
        ),
      });
      expect(audits).toHaveLength(1);
      expect(audits[0].actorEmail).toBe(staff.email);
      expect(audits[0].payload).toMatchObject({ poId: po.id, poNumber: po.poNumber });
    }
  });

  it('rejects POs belonging to a different supplier (409)', async () => {
    const va = await seedSupplier();
    const nw = await seedSupplier({ name: 'Northwind Textiles', supplierCode: 'NW' });
    const other = await seedOrderWithPo(nw.id);

    await expect(
      createShipment({
        supplierId: va.id,
        purchaseOrderIds: [other.po.id],
        shippingCostCurrency: 'USD',
      }),
    ).rejects.toThrow(`Purchase order ${other.po.poNumber} belongs to a different supplier`);
  });

  it('rejects an inactive supplier (409) and unknown supplier/PO (404)', async () => {
    const inactive = await seedSupplier({ name: 'Retired Co', supplierCode: 'RC', isActive: false });
    const active = await seedSupplier();
    const { po } = await seedOrderWithPo(active.id);

    await expect(
      createShipment({ supplierId: inactive.id, purchaseOrderIds: [po.id], shippingCostCurrency: 'USD' }),
    ).rejects.toThrow('Supplier is inactive');

    await expect(
      createShipment({ supplierId: GHOST, purchaseOrderIds: [po.id], shippingCostCurrency: 'USD' }),
    ).rejects.toThrow('Supplier not found');

    await expect(
      createShipment({ supplierId: active.id, purchaseOrderIds: [GHOST], shippingCostCurrency: 'USD' }),
    ).rejects.toThrow('Purchase order not found');
  });
});

describe('setShipmentStatus', () => {
  async function seedShipment() {
    const supplier = await seedSupplier();
    const { orderId, po } = await seedOrderWithPo(supplier.id);
    const shipment = await createShipment({
      supplierId: supplier.id,
      purchaseOrderIds: [po.id],
      shippingCostCurrency: 'USD',
    });
    return { supplier, orderId, po, shipment };
  }

  it('walks the happy path, stamping shippedAt on first transit entry and deliveredAt on delivery', async () => {
    const { orderId, po, shipment } = await seedShipment();

    const inTransit = await setShipmentStatus(shipment.id, 'in_transit', {
      actorEmail: 'sam@example.com',
    });
    expect(inTransit.status).toBe('in_transit');
    expect(inTransit.shippedAt).toBeInstanceOf(Date);
    expect(inTransit.deliveredAt).toBeNull();

    // Detour through delayed and back — shippedAt must keep the FIRST stamp.
    await setShipmentStatus(shipment.id, 'delayed');
    const resumed = await setShipmentStatus(shipment.id, 'in_transit');
    expect(resumed.shippedAt).toEqual(inTransit.shippedAt);

    const delivered = await setShipmentStatus(shipment.id, 'delivered');
    expect(delivered.status).toBe('delivered');
    expect(delivered.deliveredAt).toBeInstanceOf(Date);

    const events = await db.query.domainEvents.findMany({
      where: and(
        eq(schema.domainEvents.aggregateId, orderId),
        eq(schema.domainEvents.eventType, 'shipment.status_changed'),
      ),
    });
    expect(events).toHaveLength(4);
    expect(events.map((e) => e.payload)).toEqual(
      expect.arrayContaining([
        { shipmentId: shipment.id, from: 'pending', to: 'in_transit', poId: po.id, poNumber: po.poNumber },
        { shipmentId: shipment.id, from: 'in_transit', to: 'delayed', poId: po.id, poNumber: po.poNumber },
        { shipmentId: shipment.id, from: 'delayed', to: 'in_transit', poId: po.id, poNumber: po.poNumber },
        { shipmentId: shipment.id, from: 'in_transit', to: 'delivered', poId: po.id, poNumber: po.poNumber },
      ]),
    );

    const audits = await db.query.auditEvents.findMany({
      where: and(
        eq(schema.auditEvents.aggregateId, orderId),
        eq(schema.auditEvents.eventType, 'shipment.status_changed'),
      ),
    });
    expect(audits).toHaveLength(4);
  });

  it('delivery does NOT auto-receive the attached POs', async () => {
    const { po, shipment } = await seedShipment();

    await setShipmentStatus(shipment.id, 'in_transit');
    await setShipmentStatus(shipment.id, 'delivered');

    // Receiving stays an explicit staff action on the PO itself.
    const after = await getPurchaseOrder(po.id);
    expect(after.status).toBe('draft');
    expect(after.receivedAt).toBeNull();
  });

  it('rejects illegal transitions with a 409-mapped ConflictError', async () => {
    const { shipment } = await seedShipment();

    await expect(setShipmentStatus(shipment.id, 'delivered')).rejects.toThrow(
      'Cannot move a pending shipment to delivered',
    );

    await setShipmentStatus(shipment.id, 'in_transit');
    await expect(setShipmentStatus(shipment.id, 'cancelled')).rejects.toThrow(
      'Cannot move a in_transit shipment to cancelled',
    );
    await expect(setShipmentStatus(shipment.id, 'in_transit')).rejects.toThrow(
      'Cannot move a in_transit shipment to in_transit',
    );

    await setShipmentStatus(shipment.id, 'delivered');
    await expect(setShipmentStatus(shipment.id, 'in_transit')).rejects.toThrow(
      'Cannot move a delivered shipment to in_transit',
    );
  });

  it('404s on an unknown shipment', async () => {
    await expect(setShipmentStatus(GHOST, 'in_transit')).rejects.toThrow('Shipment not found');
  });
});

describe('updateShipment', () => {
  it('patches fields (null clears) and audits per attached parent order', async () => {
    const supplier = await seedSupplier();
    const { orderId, po } = await seedOrderWithPo(supplier.id);
    const shipment = await createShipment({
      supplierId: supplier.id,
      purchaseOrderIds: [po.id],
      carrier: 'DHL',
      notes: 'original',
      shippingCostCurrency: 'USD',
    });

    const updated = await updateShipment(
      shipment.id,
      { carrier: 'FedEx', shippingCost: 99.9, notes: null },
      { actorEmail: 'sam@example.com' },
    );
    expect(updated.carrier).toBe('FedEx');
    expect(updated.shippingCost).toBe('99.90');
    expect(updated.notes).toBeNull();

    const audits = await db.query.auditEvents.findMany({
      where: and(
        eq(schema.auditEvents.aggregateId, orderId),
        eq(schema.auditEvents.eventType, 'shipment.updated'),
      ),
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].payload).toEqual({
      shipmentId: shipment.id,
      fields: ['carrier', 'notes', 'shippingCost'],
    });

    const events = await db.query.domainEvents.findMany({
      where: and(
        eq(schema.domainEvents.aggregateId, orderId),
        eq(schema.domainEvents.eventType, 'shipment.updated'),
      ),
    });
    expect(events).toHaveLength(1);
  });
});

describe('attachPurchaseOrders / detachPurchaseOrder', () => {
  it('attaches a same-supplier PO with an audit row on its parent order, then detaches it', async () => {
    const supplier = await seedSupplier();
    const first = await seedOrderWithPo(supplier.id, 'Jane Coach');
    const second = await seedOrderWithPo(supplier.id, 'Rovers FC');
    const shipment = await createShipment({
      supplierId: supplier.id,
      purchaseOrderIds: [first.po.id],
      shippingCostCurrency: 'USD',
    });

    const attached = await attachPurchaseOrders(shipment.id, [second.po.id], {
      actorEmail: 'sam@example.com',
    });
    expect(attached.purchaseOrders.map((p) => p.id).sort()).toEqual(
      [first.po.id, second.po.id].sort(),
    );

    const attachAudits = await db.query.auditEvents.findMany({
      where: and(
        eq(schema.auditEvents.aggregateId, second.orderId),
        eq(schema.auditEvents.eventType, 'shipment.updated'),
      ),
    });
    expect(attachAudits).toHaveLength(1);
    expect(attachAudits[0].payload).toEqual({
      shipmentId: shipment.id,
      action: 'po_attached',
      poId: second.po.id,
      poNumber: second.po.poNumber,
    });

    const detached = await detachPurchaseOrder(shipment.id, second.po.id, {
      actorEmail: 'sam@example.com',
    });
    expect(detached.purchaseOrders.map((p) => p.id)).toEqual([first.po.id]);

    const detachAudits = await db.query.auditEvents.findMany({
      where: and(
        eq(schema.auditEvents.aggregateId, second.orderId),
        eq(schema.auditEvents.eventType, 'shipment.updated'),
      ),
    });
    expect(detachAudits).toHaveLength(2);
    expect(detachAudits.map((a) => (a.payload as { action: string }).action).sort()).toEqual([
      'po_attached',
      'po_detached',
    ]);
  });

  it('409s on attaching an already-attached PO', async () => {
    const supplier = await seedSupplier();
    const { po } = await seedOrderWithPo(supplier.id);
    const shipment = await createShipment({
      supplierId: supplier.id,
      purchaseOrderIds: [po.id],
      shippingCostCurrency: 'USD',
    });

    await expect(attachPurchaseOrders(shipment.id, [po.id])).rejects.toThrow(
      'Purchase order is already attached',
    );
  });

  it('409s on attaching a PO from a different supplier', async () => {
    const va = await seedSupplier();
    const nw = await seedSupplier({ name: 'Northwind Textiles', supplierCode: 'NW' });
    const mine = await seedOrderWithPo(va.id);
    const theirs = await seedOrderWithPo(nw.id);
    const shipment = await createShipment({
      supplierId: va.id,
      purchaseOrderIds: [mine.po.id],
      shippingCostCurrency: 'USD',
    });

    await expect(attachPurchaseOrders(shipment.id, [theirs.po.id])).rejects.toThrow(
      `Purchase order ${theirs.po.poNumber} belongs to a different supplier`,
    );
  });

  it('404s on detaching a PO that is not attached', async () => {
    const supplier = await seedSupplier();
    const first = await seedOrderWithPo(supplier.id, 'Jane Coach');
    const second = await seedOrderWithPo(supplier.id, 'Rovers FC');
    const shipment = await createShipment({
      supplierId: supplier.id,
      purchaseOrderIds: [first.po.id],
      shippingCostCurrency: 'USD',
    });

    await expect(detachPurchaseOrder(shipment.id, second.po.id)).rejects.toThrow(
      'Attached purchase order not found',
    );
  });
});

describe('getShipment / listShipments', () => {
  it('returns the shipment with supplier + PO summaries and 404s on unknown ids', async () => {
    const supplier = await seedSupplier();
    const { orderId, orderNumber, po } = await seedOrderWithPo(supplier.id);
    const created = await createShipment({
      supplierId: supplier.id,
      purchaseOrderIds: [po.id],
      nickname: 'Box 1',
      shippingCostCurrency: 'USD',
    });

    const shipment = await getShipment(created.id);
    expect(shipment.supplier.name).toBe('Vast Apparel');
    expect(shipment.purchaseOrders).toEqual([
      { id: po.id, poNumber: po.poNumber, status: 'draft', orderId, orderNumber },
    ]);

    await expect(getShipment(GHOST)).rejects.toThrow('Shipment not found');
  });

  it('lists newest first with supplier name/PO numbers and filters by status, supplier, and search', async () => {
    const va = await seedSupplier();
    const nw = await seedSupplier({ name: 'Northwind Textiles', supplierCode: 'NW' });
    const first = await seedOrderWithPo(va.id, 'Jane Coach');
    const second = await seedOrderWithPo(nw.id, 'Rovers FC');

    const shipA = await createShipment({
      supplierId: va.id,
      purchaseOrderIds: [first.po.id],
      nickname: 'Alpha box',
      carrier: 'DHL',
      shippingCostCurrency: 'USD',
    });
    const shipB = await createShipment({
      supplierId: nw.id,
      purchaseOrderIds: [second.po.id],
      nickname: 'Beta crate',
      carrier: 'FedEx',
      shippingCostCurrency: 'USD',
    });
    await setShipmentStatus(shipB.id, 'in_transit');

    const all = await listShipments();
    expect(all.map((s) => s.id)).toEqual([shipB.id, shipA.id]); // newest first
    expect(all[1]).toMatchObject({
      supplierName: 'Vast Apparel',
      poCount: 1,
      poNumbers: [first.po.poNumber],
    });

    const inTransit = await listShipments({ status: 'in_transit' });
    expect(inTransit.map((s) => s.id)).toEqual([shipB.id]);

    const bySupplier = await listShipments({ supplierId: va.id });
    expect(bySupplier.map((s) => s.id)).toEqual([shipA.id]);

    const byNickname = await listShipments({ search: 'beta' });
    expect(byNickname.map((s) => s.id)).toEqual([shipB.id]);

    const byPoNumber = await listShipments({ search: first.po.poNumber });
    expect(byPoNumber.map((s) => s.id)).toEqual([shipA.id]);

    const bySupplierName = await listShipments({ search: 'northwind' });
    expect(bySupplierName.map((s) => s.id)).toEqual([shipB.id]);
  });
});
