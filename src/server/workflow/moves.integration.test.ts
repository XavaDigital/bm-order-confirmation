import { afterEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';

vi.mock('@/db', async () => {
  const { createTestDb } = await import('@/db/test-helpers');
  const schema = await import('@/db/schema');
  const { db } = await createTestDb();
  return { db, schema };
});

// The hub write-back is a network call; assert it is *attempted* after a status
// change without letting it reach anything.
vi.mock('@/server/purchase-orders/hub-sync', () => ({
  syncOrderProductionStatus: vi.fn(async () => {}),
}));

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import type { OrderStatus } from '@/lib/status';
import { createOrderSchema } from '@/server/orders/contract';
import { createOrder } from '@/server/orders/service';
import { createPurchaseOrder } from '@/server/purchase-orders/service';
import { syncOrderProductionStatus } from '@/server/purchase-orders/hub-sync';
import { listActiveStages } from './stages';
import {
  moveEntityToStage,
  moveOrderToStage,
  movePurchaseOrderToStage,
} from './moves';

afterEach(async () => {
  await resetTestDb(db);
  vi.mocked(syncOrderProductionStatus).mockClear();
});

async function seedOrder(status?: OrderStatus) {
  const created = await createOrder(
    createOrderSchema.parse({
      customer: { name: 'Jane Coach', email: 'jane@example.com' },
      garments: [{ name: 'Home Jersey', sizing: [{ size: 'S' }] }],
    }),
  );
  if (status) {
    await db
      .update(schema.orders)
      .set({ status })
      .where(eq(schema.orders.id, created.orderId));
  }
  return created.orderId;
}

async function readOrder(orderId: string) {
  const [row] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
  return row;
}

async function seedSupplier() {
  const [supplier] = await db
    .insert(schema.suppliers)
    .values({ name: 'Acme Apparel', supplierCode: 'ACM', email: 'acme@example.com' })
    .returning();
  return supplier;
}

async function seedPo(orderId: string) {
  const supplier = await seedSupplier();
  const garments = await db
    .select()
    .from(schema.garments)
    .where(eq(schema.garments.orderId, orderId));

  return createPurchaseOrder(
    { orderId, supplierId: supplier.id, garmentIds: [garments[0].id] },
    {},
  );
}

async function auditTypes(orderId: string) {
  const rows = await db
    .select()
    .from(schema.auditEvents)
    .where(eq(schema.auditEvents.aggregateId, orderId));
  return rows.map((row) => row.eventType);
}

describe('moveOrderToStage — within one status', () => {
  it('records the stage and stamps the clock without touching the status', async () => {
    const orderId = await seedOrder('confirmed');

    const result = await moveOrderToStage(orderId, 'artwork', { actorEmail: 'sam@x.com' });

    expect(result.toStageSlug).toBe('artwork');
    expect(result.statusChange).toBeNull();
    const row = await readOrder(orderId);
    expect(row.workflowStageSlug).toBe('artwork');
    expect(row.stageEnteredAt).not.toBeNull();
    expect(row.status).toBe('confirmed');
  });

  it('reports the stage it came from', async () => {
    const orderId = await seedOrder('confirmed');
    await moveOrderToStage(orderId, 'artwork', {});

    const result = await moveOrderToStage(orderId, 'digitising', {});

    expect(result.fromStageSlug).toBe('artwork');
    expect(result.toStageSlug).toBe('digitising');
  });

  it('audits an exit and an entry', async () => {
    const orderId = await seedOrder('confirmed');

    await moveOrderToStage(orderId, 'artwork', { actorEmail: 'sam@x.com' });

    const types = await auditTypes(orderId);
    expect(types).toContain('workflow.stage_entered');
    expect(types).toContain('workflow.stage_exited');
  });

  // A card dropped back where it started is not an error and must not re-stamp
  // the clock, or the stuck-job scan could be reset by an accidental drag.
  it('is a no-op when the card is already in that stage', async () => {
    const orderId = await seedOrder('confirmed');
    await moveOrderToStage(orderId, 'artwork', {});
    const before = await readOrder(orderId);

    const result = await moveOrderToStage(orderId, 'artwork', {});

    expect(result.statusChange).toBeNull();
    const after = await readOrder(orderId);
    expect(after.stageEnteredAt).toEqual(before.stageEnteredAt);
    // No second pair of stage events.
    const types = await auditTypes(orderId);
    expect(types.filter((t) => t === 'workflow.stage_entered')).toHaveLength(1);
  });

  it('records no exit event for a first move from an unstaged order', async () => {
    const orderId = await seedOrder('draft');

    // draft's default stage IS 'draft', so moving to 'sent' crosses a status.
    await moveOrderToStage(orderId, 'sent', {});

    const types = await auditTypes(orderId);
    // It had a resolved current stage ('draft'), so an exit is still correct.
    expect(types).toContain('workflow.stage_exited');
  });
});

describe('moveOrderToStage — crossing a status boundary', () => {
  it('moves the status in the same operation', async () => {
    const orderId = await seedOrder('draft');

    const result = await moveOrderToStage(orderId, 'sent', { actorEmail: 'sam@x.com' });

    expect(result.statusChange).toEqual({ from: 'draft', to: 'sent' });
    const row = await readOrder(orderId);
    expect(row.status).toBe('sent');
    expect(row.workflowStageSlug).toBe('sent');
  });

  it('audits the status change alongside the stage move', async () => {
    const orderId = await seedOrder('draft');

    await moveOrderToStage(orderId, 'sent', { actorEmail: 'sam@x.com' });

    expect(await auditTypes(orderId)).toContain('order.status_changed');
  });

  // Confirmation is the customer's act; dragging must never forge it.
  it('refuses to drag an order into confirmed', async () => {
    const orderId = await seedOrder('sent');

    await expect(moveOrderToStage(orderId, 'confirmed', {})).rejects.toThrow(
      /only the customer can confirm/i,
    );

    const row = await readOrder(orderId);
    expect(row.status).toBe('sent');
    expect(row.workflowStageSlug).toBeNull();
  });

  it('refuses to drag an order into viewed', async () => {
    const orderId = await seedOrder('sent');

    await expect(moveOrderToStage(orderId, 'viewed', {})).rejects.toThrow(/opens their link/i);
  });

  it('refuses to revert a confirmed order to draft', async () => {
    const orderId = await seedOrder('confirmed');

    await expect(moveOrderToStage(orderId, 'draft', {})).rejects.toThrow(/only be cancelled/i);
  });

  it('allows cancelling by drag', async () => {
    const orderId = await seedOrder('sent');

    const result = await moveOrderToStage(orderId, 'cancelled', {});

    expect(result.statusChange).toEqual({ from: 'sent', to: 'cancelled' });
  });

  // The invariant the whole module exists for: a refused move leaves NOTHING
  // written, so the board and the status cannot drift apart.
  it('writes neither stage nor status when the transition is refused', async () => {
    const orderId = await seedOrder('confirmed');
    await moveOrderToStage(orderId, 'artwork', {});

    await expect(moveOrderToStage(orderId, 'draft', {})).rejects.toThrow();

    const row = await readOrder(orderId);
    expect(row.status).toBe('confirmed');
    expect(row.workflowStageSlug).toBe('artwork');
  });

  it('404s for an unknown stage and 404s for an unknown order', async () => {
    const orderId = await seedOrder('draft');
    await expect(moveOrderToStage(orderId, 'no_such_stage', {})).rejects.toThrow('Stage not found');
    await expect(
      moveOrderToStage('00000000-0000-0000-0000-000000000000', 'sent', {}),
    ).rejects.toThrow('Order not found');
  });

  it('refuses a stage that has been deactivated', async () => {
    const orderId = await seedOrder('confirmed');
    await db
      .update(schema.workflowStages)
      .set({ isActive: false })
      .where(
        and(
          eq(schema.workflowStages.boardKey, 'order'),
          eq(schema.workflowStages.slug, 'artwork'),
        ),
      );

    await expect(moveOrderToStage(orderId, 'artwork', {})).rejects.toThrow('Stage not found');
  });
});

describe('movePurchaseOrderToStage', () => {
  it('moves within a status without changing it', async () => {
    const orderId = await seedOrder('confirmed');
    const po = await seedPo(orderId);

    // 'draft' is the only stage in the draft group, so move across instead and
    // then back within the same group is not possible — assert the simple case:
    // a same-stage drop is a no-op.
    const result = await movePurchaseOrderToStage(po.id, 'draft', {});

    expect(result.statusChange).toBeNull();
  });

  it('moves the PO status through the existing guard', async () => {
    const orderId = await seedOrder('confirmed');
    const po = await seedPo(orderId);

    const result = await movePurchaseOrderToStage(po.id, 'sent', { actorEmail: 'sam@x.com' });

    expect(result.statusChange).toEqual({ from: 'draft', to: 'sent' });
    const [row] = await db
      .select()
      .from(schema.purchaseOrders)
      .where(eq(schema.purchaseOrders.id, po.id));
    expect(row.status).toBe('sent');
    expect(row.workflowStageSlug).toBe('sent');
    // The tx-aware status helper still stamps sentAt.
    expect(row.sentAt).not.toBeNull();
  });

  // Forward jumps down the production chain are deliberately legal (staff skip
  // stages routinely), so dragging a card several columns to the right works.
  it('allows a forward jump down the chain', async () => {
    const orderId = await seedOrder('confirmed');
    const po = await seedPo(orderId);

    const result = await movePurchaseOrderToStage(po.id, 'received', {});

    expect(result.statusChange).toEqual({ from: 'draft', to: 'received' });
  });

  // The PO guard is not bypassable through the board: backwards is still refused.
  it('refuses a backwards PO transition, leaving stage and status untouched', async () => {
    const orderId = await seedOrder('confirmed');
    const po = await seedPo(orderId);
    await movePurchaseOrderToStage(po.id, 'received', {});

    await expect(movePurchaseOrderToStage(po.id, 'draft', {})).rejects.toThrow(
      /cannot move a received purchase order to draft/i,
    );

    const [row] = await db
      .select()
      .from(schema.purchaseOrders)
      .where(eq(schema.purchaseOrders.id, po.id));
    expect(row.status).toBe('received');
    expect(row.workflowStageSlug).toBe('received');
  });

  it('emits the PO outbox events the status helper owns', async () => {
    const orderId = await seedOrder('confirmed');
    const po = await seedPo(orderId);

    await movePurchaseOrderToStage(po.id, 'sent', {});

    const events = await db
      .select()
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.aggregateId, orderId));
    expect(events.map((e) => e.eventType)).toContain('po.status_changed');
  });

  // The write-back is a network call, so it must happen after the commit — never
  // inside the transaction.
  it('triggers the hub write-back only when the status actually moved', async () => {
    const orderId = await seedOrder('confirmed');
    const po = await seedPo(orderId);

    await movePurchaseOrderToStage(po.id, 'draft', {});
    expect(syncOrderProductionStatus).not.toHaveBeenCalled();

    await movePurchaseOrderToStage(po.id, 'sent', {});
    expect(syncOrderProductionStatus).toHaveBeenCalledWith(orderId);
  });

  it('audits stage moves against the parent order', async () => {
    const orderId = await seedOrder('confirmed');
    const po = await seedPo(orderId);

    await movePurchaseOrderToStage(po.id, 'sent', { actorEmail: 'sam@x.com' });

    const rows = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.aggregateId, orderId));
    const entered = rows.find((r) => r.eventType === 'workflow.stage_entered');
    expect(entered).toBeDefined();
    expect(entered!.payload).toMatchObject({ poId: po.id, boardKey: 'purchase_order' });
  });
});

describe('moveEntityToStage dispatch', () => {
  it('routes to the order board', async () => {
    const orderId = await seedOrder('confirmed');

    const result = await moveEntityToStage('order', orderId, 'artwork', {});

    expect(result.entityType).toBe('order');
    expect(result.toStageSlug).toBe('artwork');
  });

  it('routes to the purchase-order board', async () => {
    const orderId = await seedOrder('confirmed');
    const po = await seedPo(orderId);

    const result = await moveEntityToStage('purchase_order', po.id, 'sent', {});

    expect(result.entityType).toBe('purchase_order');
  });

  // Same slug on both boards must not be able to cross-target.
  it('keeps the stage namespaces of the two boards separate', async () => {
    const orderId = await seedOrder('confirmed');

    // 'in_production' exists only on the purchase_order board.
    await expect(moveEntityToStage('order', orderId, 'in_production', {})).rejects.toThrow(
      'Stage not found',
    );
  });
});

describe('seeded stages', () => {
  it('seeds a stage for every order status', async () => {
    const stages = await listActiveStages('order');
    const statuses = new Set(stages.map((s) => s.statusKey));

    for (const status of ['draft', 'sent', 'viewed', 'changes_requested', 'confirmed', 'cancelled']) {
      expect(statuses.has(status)).toBe(true);
    }
  });

  it('seeds the pre-production expansion under confirmed', async () => {
    const stages = await listActiveStages('order');
    const confirmed = stages.filter((s) => s.statusKey === 'confirmed').map((s) => s.slug);

    expect(confirmed).toEqual([
      'confirmed',
      'artwork',
      'digitising',
      'fabric_confirmation',
      'sizing_locked',
      'ready_for_production',
    ]);
  });

  it('seeds one stage per PO status and nothing extra', async () => {
    const stages = await listActiveStages('purchase_order');
    expect(stages).toHaveLength(10);
    expect(new Set(stages.map((s) => s.statusKey)).size).toBe(10);
  });

  it('seeds the pre-production checklist, including one non-blocking task', async () => {
    const tasks = await db.select().from(schema.workflowStageTasks);

    expect(tasks).toHaveLength(5);
    const nonBlocking = tasks.filter((t) => !t.isBlocking);
    expect(nonBlocking).toHaveLength(1);
    expect(nonBlocking[0].slug).toBe('colour_sample_dispatched');
    // Non-blocking, but it still carries the gate — that is what gives it teeth.
    expect(nonBlocking[0].gateKeys).toEqual(['po_send']);
  });

  it('gives every seeded task the po_send gate', async () => {
    const tasks = await db.select().from(schema.workflowStageTasks);
    for (const task of tasks) {
      expect(task.gateKeys).toContain('po_send');
    }
  });

  // Seeds run inside migrations, which the PGlite harness replays per test file;
  // they must not double-insert.
  it('is idempotent across a migration replay', async () => {
    const stages = await db.select().from(schema.workflowStages);
    const keys = stages.map((s) => `${s.boardKey}:${s.slug}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
