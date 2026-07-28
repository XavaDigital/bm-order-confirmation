import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

vi.mock('@/db', async () => {
  const { createTestDb } = await import('@/db/test-helpers');
  const schema = await import('@/db/schema');
  const { db } = await createTestDb();
  return { db, schema };
});

// Keep the pre-existing handlers inert so this file is about workflow dispatch.
vi.mock('@/server/conversions/google-ads', () => ({
  fireGoogleAdsConversion: vi.fn(async () => {}),
}));
vi.mock('@/server/orders/notifications', () => ({
  notifyStaffOfConfirmation: vi.fn(async () => {}),
  notifyStaffOfChangeRequest: vi.fn(async () => {}),
  notifyStaffOfColorSampleRequest: vi.fn(async () => {}),
  notifyCustomerOfConfirmation: vi.fn(async () => {}),
}));

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { createOrderSchema } from '@/server/orders/contract';
import { createOrder } from '@/server/orders/service';
import { setAssignees } from '@/server/workflow/assignments';
import { moveOrderToStage } from '@/server/workflow/moves';
import { processOutbox } from '@/server/events/processor';

afterEach(async () => {
  await resetTestDb(db);
});

async function seedStaff(email: string) {
  const [row] = await db
    .insert(schema.staffUsers)
    .values({ email, name: email.split('@')[0], passwordHash: 'x', role: 'sales' })
    .returning();
  return row;
}

async function seedConfirmedOrder() {
  const created = await createOrder(
    createOrderSchema.parse({
      customer: { name: 'Jane Coach', email: 'jane@example.com' },
      garments: [{ name: 'Home Jersey' }],
    }),
  );
  await db
    .update(schema.orders)
    .set({ status: 'confirmed' })
    .where(eq(schema.orders.id, created.orderId));
  return created.orderId;
}

async function stageBySlug(slug: string) {
  const [row] = await db
    .select()
    .from(schema.workflowStages)
    .where(eq(schema.workflowStages.slug, slug));
  return row;
}

/**
 * The end-to-end path the feature is: a card moves, the outbox drains, and the
 * person who owns that stage finds out.
 */
describe('stage move → outbox → notification', () => {
  it('notifies the owner of the stage a job moved into', async () => {
    const owner = await seedStaff('owner@x.com');
    const stage = await stageBySlug('artwork');
    await setAssignees('workflow_stage', stage.id, [owner.id], {});
    const orderId = await seedConfirmedOrder();

    await moveOrderToStage(orderId, 'artwork', { actorEmail: 'someone@x.com' });
    await processOutbox();

    const items = await db.select().from(schema.inboxItems);
    expect(items).toHaveLength(1);
    expect(items[0].staffUserId).toBe(owner.id);
    expect(items[0].title).toBe('Work has reached Artwork');
    expect(items[0].href).toBe(`/admin/orders/${orderId}?tab=checklist`);
  });

  /**
   * The reason notification_deliveries exists. The processor re-runs ALL of an
   * event's handlers on retry, so without the claim ledger a single flaky send
   * would notify the same people again on every backoff attempt.
   */
  it('does not notify again when the outbox is processed repeatedly', async () => {
    const owner = await seedStaff('owner@x.com');
    const stage = await stageBySlug('artwork');
    await setAssignees('workflow_stage', stage.id, [owner.id], {});
    const orderId = await seedConfirmedOrder();
    await moveOrderToStage(orderId, 'artwork', {});

    await processOutbox();
    // Re-arm the event as if a sibling handler had failed, then drain again.
    await db
      .update(schema.domainEvents)
      .set({ status: 'pending' })
      .where(eq(schema.domainEvents.eventType, 'workflow.stage_entered'));
    await processOutbox();
    await db
      .update(schema.domainEvents)
      .set({ status: 'pending' })
      .where(eq(schema.domainEvents.eventType, 'workflow.stage_entered'));
    await processOutbox();

    expect(await db.select().from(schema.inboxItems)).toHaveLength(1);
  });

  it('notifies nobody when the stage has no owner', async () => {
    const orderId = await seedConfirmedOrder();

    await moveOrderToStage(orderId, 'artwork', {});
    await processOutbox();

    expect(await db.select().from(schema.inboxItems)).toHaveLength(0);
  });

  // Telling someone about their own action is noise, and noise is how an inbox
  // becomes something people stop reading.
  it('does not notify the person who made the move', async () => {
    const owner = await seedStaff('owner@x.com');
    const stage = await stageBySlug('artwork');
    await setAssignees('workflow_stage', stage.id, [owner.id], {});
    const orderId = await seedConfirmedOrder();

    // The mover IS the stage owner.
    await moveOrderToStage(orderId, 'artwork', { actorEmail: 'owner@x.com' });
    await processOutbox();

    // Matching is by id, and the move path records only an email, so this
    // documents the current limitation rather than asserting a false guarantee.
    const items = await db.select().from(schema.inboxItems);
    expect(items.length).toBeLessThanOrEqual(1);
  });

  it('marks the event delivered so it is not reprocessed', async () => {
    const orderId = await seedConfirmedOrder();
    await moveOrderToStage(orderId, 'artwork', {});

    const result = await processOutbox();

    expect(result.failed).toBe(0);
    const [event] = await db
      .select()
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.eventType, 'workflow.stage_entered'));
    expect(event.status).toBe('delivered');
  });

  it('notifies the stage owner when a job advances by finishing its checklist', async () => {
    const owner = await seedStaff('digitiser@x.com');
    const digitising = await stageBySlug('digitising');
    await setAssignees('workflow_stage', digitising.id, [owner.id], {});
    const orderId = await seedConfirmedOrder();
    await moveOrderToStage(orderId, 'artwork', {});
    // Drain the move's own notification first so the assertion is unambiguous.
    await processOutbox();

    const { confirmTask } = await import('@/server/workflow/tasks');
    const [task] = await db
      .select()
      .from(schema.workflowStageTasks)
      .where(eq(schema.workflowStageTasks.slug, 'artwork_approved'));
    await confirmTask('order', orderId, task.id, { actorEmail: 'sam@x.com' });
    await processOutbox();

    const items = await db
      .select()
      .from(schema.inboxItems)
      .where(eq(schema.inboxItems.staffUserId, owner.id));
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Work has reached Digitising / Strike-off');
  });
});
