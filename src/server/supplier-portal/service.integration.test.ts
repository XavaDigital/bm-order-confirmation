import { afterEach, describe, expect, it, vi } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';

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
  generateSupplierPortalLink,
  revokeSupplierPortalLink,
  updatePurchaseOrderStatus,
} from '@/server/purchase-orders/service';
import { hashToken } from '@/lib/tokens';
import {
  addSupplierComment,
  resolveSupplierPortalView,
  updateSupplierPoStatus,
} from './service';

afterEach(async () => {
  await resetTestDb(db);
});

async function seedSupplier() {
  const [supplier] = await db
    .insert(schema.suppliers)
    .values({ name: 'Vast Apparel', supplierCode: 'VA', email: 'factory@example.com' })
    .returning();
  return supplier;
}

async function seedOrder() {
  const created = await createOrder(
    createOrderSchema.parse({
      customer: { name: 'Jane Coach', email: 'jane@example.com' },
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

/** generateSupplierPortalLink returns the full portal URL — the raw token is its last path segment. */
function tokenFromUrl(url: string): string {
  return url.split('/').pop()!;
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
  const url = await generateSupplierPortalLink(po.id);
  return { po, orderId, supplier, rawToken: tokenFromUrl(url) };
}

describe('resolveSupplierPortalView', () => {
  it('returns the PO snapshot, allowed next statuses, and shared comments only', async () => {
    const { po, orderId, rawToken } = await seedPoWithToken();

    await addOrderNote(orderId, {
      body: 'internal pricing chat',
      authorKind: 'staff',
      isHtml: false,
    });
    await addSupplierComment(rawToken, 'When do you need the artwork?');

    const view = await resolveSupplierPortalView(rawToken);

    expect(view.poNumber).toBe(po.poNumber);
    expect(view.status).toBe('sent');
    // 'sent' → allowed forward targets among the supplier-safe subset.
    expect(view.allowedNextStatuses).toEqual(['confirmed', 'pre_production', 'in_production', 'in_transit']);
    expect(view.snapshot.garments).toHaveLength(1);
    expect(view.snapshot.garments[0].lines[0]).toMatchObject({ playerName: 'Alice' });

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

    await revokeSupplierPortalLink(po.id);
    await expect(resolveSupplierPortalView(rawToken)).rejects.toThrow('invalid_token');
  });
});

describe('updateSupplierPoStatus', () => {
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

  it('rejects a status outside the supplier-safe subset (received/completed/sent/cancelled/remake)', async () => {
    const { rawToken } = await seedPoWithToken();

    for (const disallowed of ['received', 'completed', 'sent', 'cancelled', 'remake'] as const) {
      // @ts-expect-error — exercising the runtime guard against out-of-union values too.
      await expect(updateSupplierPoStatus(rawToken, disallowed)).rejects.toThrow('status_not_allowed');
    }
  });

  it('rejects an illegal transition even within the allowed subset (no backward moves)', async () => {
    const { po, rawToken } = await seedPoWithToken();
    await updatePurchaseOrderStatus(po.id, 'in_transit');

    await expect(updateSupplierPoStatus(rawToken, 'confirmed')).rejects.toThrow('illegal_transition');
  });

  it('throws invalid_token for a revoked link', async () => {
    const { po, rawToken } = await seedPoWithToken();
    await revokeSupplierPortalLink(po.id);

    await expect(updateSupplierPoStatus(rawToken, 'confirmed')).rejects.toThrow('invalid_token');
  });
});

describe('addSupplierComment', () => {
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

describe('generateSupplierPortalLink / revokeSupplierPortalLink', () => {
  it('mints one active token per PO and rotates on regenerate', async () => {
    const { po, rawToken } = await seedPoWithToken();

    const secondRawToken = tokenFromUrl(await generateSupplierPortalLink(po.id));

    const activeRows = await db
      .select()
      .from(schema.poSupplierAccess)
      .where(and(eq(schema.poSupplierAccess.purchaseOrderId, po.id), isNull(schema.poSupplierAccess.revokedAt)));
    expect(activeRows).toHaveLength(1);
    expect(activeRows[0].tokenHash).toBe(hashToken(secondRawToken));

    // The FIRST token minted in seedPoWithToken should now be revoked.
    await expect(resolveSupplierPortalView(rawToken)).rejects.toThrow('invalid_token');
    await expect(resolveSupplierPortalView(secondRawToken)).resolves.toBeDefined();
  });

  it('revoke clears the active link', async () => {
    const { po, rawToken } = await seedPoWithToken();
    await revokeSupplierPortalLink(po.id);

    await expect(resolveSupplierPortalView(rawToken)).rejects.toThrow('invalid_token');

    const events = await db.query.domainEvents.findMany({
      where: eq(schema.domainEvents.eventType, 'supplier_link.revoked'),
    });
    expect(events).toHaveLength(1);
  });
});
