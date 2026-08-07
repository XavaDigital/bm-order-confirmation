/**
 * "Was any check on this job skipped rather than done?" (David, 2026-08-07).
 *
 * The fact has to survive the trip from wherever the skip was recorded to the
 * automation that acts on it, so these tests pin BOTH ends: the reader itself,
 * and that a purchase order changing status carries the answer on its event —
 * which is what an automation rule matches against.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';

vi.mock('@/db', async () => {
  const { createTestDb } = await import('@/db/test-helpers');
  const schema = await import('@/db/schema');
  const { db } = await createTestDb();
  return { db, schema };
});

vi.mock('@/server/purchase-orders/hub-sync', () => ({
  syncOrderProductionStatus: vi.fn(async () => {}),
}));

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { createOrder } from '@/server/orders/service';
import { createOrderSchema } from '@/server/orders/contract';
import { createPurchaseOrder, updatePurchaseOrderStatus } from '@/server/purchase-orders/service';
import { setChecklistItem } from '@/server/purchase-orders/checklist-service';
import { listSidesteppedChecks } from './sidesteps';

afterEach(async () => {
  await resetTestDb(db);
});

// Supplier codes are unique, so a test seeding two jobs needs two codes.
let seedCount = 0;

async function seedJob() {
  seedCount += 1;
  const [supplier] = await db
    .insert(schema.suppliers)
    .values({
      name: `Dynasty ${seedCount}`,
      supplierCode: `D${seedCount}`,
      email: `dy${seedCount}@example.com`,
    })
    .returning();
  const created = await createOrder(
    createOrderSchema.parse({
      customer: { name: 'Jane Coach', email: 'jane@example.com' },
      garments: [{ name: 'Team Hoodie', sizing: [{ size: 'M' }] }],
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
  return { orderId: created.orderId, po };
}

/** A stage task by slug — the seeded pre-production checks live on the order board. */
async function taskBySlug(slug: string) {
  const [row] = await db
    .select()
    .from(schema.workflowStageTasks)
    .where(eq(schema.workflowStageTasks.slug, slug));
  return row;
}

/**
 * Written straight to the table rather than through `sidestepTask`, because
 * these cases are about what the READER counts — a task the entity's current
 * stage does not own cannot be sidestepped through the service at all, and
 * arranging each entity's stage would test the mover, not the reader.
 */
async function recordSidestep(
  entityType: 'order' | 'purchase_order',
  entityId: string,
  taskId: string,
  staffUserId?: string,
) {
  await db.insert(schema.workflowTaskCompletions).values({
    taskId,
    entityType,
    entityId,
    confirmedByStaffUserId: staffUserId ?? null,
    confirmedByEmail: 'sam@x.com',
    sidestepped: true,
    sidestepReason: 'no colour sample on this job',
  });
}

/** A staff row, so two acknowledgements of one task can be distinct rows. */
async function seedStaff(email: string) {
  const [user] = await db
    .insert(schema.staffUsers)
    .values({ email, name: email, passwordHash: 'x', role: 'sales' })
    .returning();
  return user;
}

describe('listSidesteppedChecks', () => {
  it('reports nothing for a job where every check still stands', async () => {
    const { orderId, po } = await seedJob();

    expect(await listSidesteppedChecks(db, orderId, po.id)).toEqual({ count: 0, labels: [] });
  });

  it('counts a stage check skipped on the ORDER board', async () => {
    const { orderId, po } = await seedJob();
    const task = await taskBySlug('colour_sample_dispatched');

    await recordSidestep('order', orderId, task.id);

    const result = await listSidesteppedChecks(db, orderId, po.id);
    expect(result.count).toBe(1);
    expect(result.labels).toEqual(['Colour sample dispatched']);
  });

  it('counts a check skipped on the purchase order’s pre-send checklist', async () => {
    const { orderId, po } = await seedJob();
    const [item] = await db
      .select()
      .from(schema.poChecklistItems)
      .where(eq(schema.poChecklistItems.allowSidestep, true));

    await setChecklistItem(po.id, item.id, true, {
      actorEmail: 'sam@x.com',
      sidestepReason: 'no fonts on this job',
    });

    const result = await listSidesteppedChecks(db, orderId, po.id);
    expect(result.count).toBe(1);
    expect(result.labels).toEqual([item.label]);
  });

  // Both sinks count, or a decision taken on the board would raise a flag while
  // the same decision taken on the checklist did not.
  it('adds up skips from the board and the checklist together', async () => {
    const { orderId, po } = await seedJob();
    const task = await taskBySlug('colour_sample_dispatched');
    const [item] = await db
      .select()
      .from(schema.poChecklistItems)
      .where(eq(schema.poChecklistItems.allowSidestep, true));

    await recordSidestep('order', orderId, task.id);
    await setChecklistItem(po.id, item.id, true, {
      actorEmail: 'sam@x.com',
      sidestepReason: 'no fonts',
    });

    const result = await listSidesteppedChecks(db, orderId, po.id);
    expect(result.count).toBe(2);
    expect(result.labels).toContain('Colour sample dispatched');
    expect(result.labels).toContain(item.label);
  });

  // Retiring a check must not leave every old job flagged forever.
  it('ignores a skip against a check that has since been deactivated', async () => {
    const { orderId, po } = await seedJob();
    const task = await taskBySlug('colour_sample_dispatched');
    await recordSidestep('order', orderId, task.id);

    await db
      .update(schema.workflowStageTasks)
      .set({ isActive: false })
      .where(eq(schema.workflowStageTasks.id, task.id));

    expect(await listSidesteppedChecks(db, orderId, po.id)).toEqual({ count: 0, labels: [] });
  });

  // An `all`-policy task records one row per person; the question is which
  // checks were skipped, not how many acknowledgements were given.
  it('counts a check once however many people acknowledged it', async () => {
    const { orderId, po } = await seedJob();
    const task = await taskBySlug('colour_sample_dispatched');

    const sam = await seedStaff('sam@x.com');
    const ana = await seedStaff('ana@x.com');
    await recordSidestep('order', orderId, task.id, sam.id);
    await recordSidestep('order', orderId, task.id, ana.id);

    const result = await listSidesteppedChecks(db, orderId, po.id);
    expect(result.count).toBe(1);
    expect(result.labels).toEqual(['Colour sample dispatched']);
  });

  it('does not pick up another job’s skipped check', async () => {
    const { orderId, po } = await seedJob();
    const other = await seedJob();
    const task = await taskBySlug('colour_sample_dispatched');

    await recordSidestep('order', other.orderId, task.id);

    expect(await listSidesteppedChecks(db, orderId, po.id)).toEqual({ count: 0, labels: [] });
  });

  // A tick is not a skip. Counting plain confirmations would flag every job.
  it('does not count a check that was actually done', async () => {
    const { orderId, po } = await seedJob();
    const task = await taskBySlug('colour_sample_dispatched');
    await db.insert(schema.workflowTaskCompletions).values({
      taskId: task.id,
      entityType: 'order',
      entityId: orderId,
      confirmedByEmail: 'sam@x.com',
    });

    expect(await listSidesteppedChecks(db, orderId, po.id)).toEqual({ count: 0, labels: [] });
  });
});

describe('po.status_changed carries the skipped-check answer', () => {
  async function statusEvents(orderId: string) {
    return db
      .select()
      .from(schema.domainEvents)
      .where(
        and(
          eq(schema.domainEvents.aggregateId, orderId),
          eq(schema.domainEvents.eventType, 'po.status_changed'),
        ),
      );
  }

  it('says no when every check still stands', async () => {
    const { orderId, po } = await seedJob();

    await updatePurchaseOrderStatus(po.id, 'sent');

    const [event] = await statusEvents(orderId);
    expect(event.payload).toMatchObject({ to: 'sent', sidestepped: 'no', sidesteppedChecks: [] });
  });

  it('says yes and names the check when one was skipped', async () => {
    const { orderId, po } = await seedJob();
    const task = await taskBySlug('colour_sample_dispatched');
    await recordSidestep('order', orderId, task.id);

    await updatePurchaseOrderStatus(po.id, 'sent');

    const [event] = await statusEvents(orderId);
    expect(event.payload).toMatchObject({
      sidestepped: 'yes',
      sidesteppedChecks: ['Colour sample dispatched'],
    });
  });

  // The answer is about the moment the purchase order moved. Reading it later
  // would give a different answer if someone ticked the check off in between,
  // and the outbox re-runs handlers on retry.
  it('keeps the answer that was true when the move happened', async () => {
    const { orderId, po } = await seedJob();
    const task = await taskBySlug('colour_sample_dispatched');
    await recordSidestep('order', orderId, task.id);
    await updatePurchaseOrderStatus(po.id, 'sent');

    await db
      .delete(schema.workflowTaskCompletions)
      .where(eq(schema.workflowTaskCompletions.taskId, task.id));

    const [event] = await statusEvents(orderId);
    expect(event.payload).toMatchObject({ sidestepped: 'yes' });
  });
});
