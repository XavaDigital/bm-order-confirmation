/**
 * "Tell someone when a skipped check reaches production" (David, 2026-08-07).
 *
 * The whole point is that a decision to skip a pre-production check is allowed,
 * but the person who made it is not necessarily the person who should confirm
 * it was safe. So this tests the path end to end — a check is skipped, the
 * purchase order reaches production, the outbox drains, and an admin is told —
 * rather than any one link in it. The seeded rule (migration 0048) is the
 * subject: if it stops matching, nobody finds out about a skipped check.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

vi.mock('@/db', async () => {
  const { createTestDb } = await import('@/db/test-helpers');
  const schema = await import('@/db/schema');
  const { db } = await createTestDb();
  return { db, schema };
});

vi.mock('@/server/purchase-orders/hub-sync', () => ({
  syncOrderProductionStatus: vi.fn(async () => {}),
}));
vi.mock('@/server/conversions/google-ads', () => ({
  fireGoogleAdsConversion: vi.fn(async () => {}),
}));

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { createOrderSchema } from '@/server/orders/contract';
import { createOrder } from '@/server/orders/service';
import { createPurchaseOrder, updatePurchaseOrderStatus } from '@/server/purchase-orders/service';
import { processOutbox } from '@/server/events/processor';

afterEach(async () => {
  await resetTestDb(db);
});

let seedCount = 0;

async function seedAdmin(email = 'boss@example.com') {
  const [row] = await db
    .insert(schema.staffUsers)
    .values({ email, name: 'Boss', passwordHash: 'x', role: 'admin' })
    .returning();
  return row;
}

async function seedJob() {
  seedCount += 1;
  const [supplier] = await db
    .insert(schema.suppliers)
    .values({
      name: `Dynasty ${seedCount}`,
      supplierCode: `S${seedCount}`,
      email: `s${seedCount}@example.com`,
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

async function skipACheck(orderId: string) {
  const [task] = await db
    .select()
    .from(schema.workflowStageTasks)
    .where(eq(schema.workflowStageTasks.slug, 'colour_sample_dispatched'));
  await db.insert(schema.workflowTaskCompletions).values({
    taskId: task.id,
    entityType: 'order',
    entityId: orderId,
    confirmedByEmail: 'sam@example.com',
    sidestepped: true,
    sidestepReason: 'customer did not ask for a sample',
  });
  return task;
}

async function notificationsFor(staffUserId: string) {
  return db
    .select()
    .from(schema.inboxItems)
    .where(eq(schema.inboxItems.staffUserId, staffUserId));
}

describe('a skipped check reaching production', () => {
  it('tells an admin, naming the check that was skipped', async () => {
    const admin = await seedAdmin();
    const { orderId, po } = await seedJob();
    await skipACheck(orderId);

    await updatePurchaseOrderStatus(po.id, 'in_production');
    await processOutbox();

    const notes = await notificationsFor(admin.id);
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toMatch(/skipped check reached production/i);
    // Actionable: "go and look" has to say at what.
    expect(notes[0].body).toContain('Colour sample dispatched');
    expect(notes[0].href).toBe(`/admin/purchase-orders/${po.id}`);
  });

  it('stays quiet when every check was actually done', async () => {
    const admin = await seedAdmin();
    const { po } = await seedJob();

    await updatePurchaseOrderStatus(po.id, 'in_production');
    await processOutbox();

    expect(await notificationsFor(admin.id)).toHaveLength(0);
  });

  // The rule is narrowed to Production. A skipped check is not news at every
  // step, or the notification becomes noise people learn to dismiss.
  it('stays quiet at a status the rule does not name', async () => {
    const admin = await seedAdmin();
    const { orderId, po } = await seedJob();
    await skipACheck(orderId);

    await updatePurchaseOrderStatus(po.id, 'sent');
    await processOutbox();

    expect(await notificationsFor(admin.id)).toHaveLength(0);
  });

  // The outbox re-runs every handler on retry, so the claim ledger has to make
  // this at-most-once — otherwise one flaky send re-notifies on every attempt.
  it('does not notify twice when the outbox is drained again', async () => {
    const admin = await seedAdmin();
    const { orderId, po } = await seedJob();
    await skipACheck(orderId);

    await updatePurchaseOrderStatus(po.id, 'in_production');
    await processOutbox();
    await processOutbox();

    expect(await notificationsFor(admin.id)).toHaveLength(1);
  });

  /**
   * A remake goes round the loop and reaches production a second time. That is
   * a fresh occurrence, not a retry, so it has to notify again — the dedupe key
   * carries the provoking event's id for exactly this reason.
   */
  it('notifies again when a remake brings the job back to production', async () => {
    const admin = await seedAdmin();
    const { orderId, po } = await seedJob();
    await skipACheck(orderId);

    await updatePurchaseOrderStatus(po.id, 'in_production');
    await processOutbox();
    await updatePurchaseOrderStatus(po.id, 'received');
    await updatePurchaseOrderStatus(po.id, 'remake');
    await updatePurchaseOrderStatus(po.id, 'in_production');
    await processOutbox();

    expect(await notificationsFor(admin.id)).toHaveLength(2);
  });
});
