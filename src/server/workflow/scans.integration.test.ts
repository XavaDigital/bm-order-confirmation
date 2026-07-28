import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

vi.mock('@/db', async () => {
  const { createTestDb } = await import('@/db/test-helpers');
  const schema = await import('@/db/schema');
  const { db } = await createTestDb();
  return { db, schema };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { createOrderSchema } from '@/server/orders/contract';
import { createOrder } from '@/server/orders/service';
import { setAssignees } from './assignments';
import { moveOrderToStage } from './moves';
import {
  clearReminder,
  listRemindersForUser,
  runWorkflowScans,
  stuckDedupeKey,
  upsertReminder,
} from './scans';

afterEach(async () => {
  await resetTestDb(db);
});

const NOW = new Date('2026-07-20T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 3_600_000);

async function seedStaff(email: string) {
  const [row] = await db
    .insert(schema.staffUsers)
    .values({ email, name: email.split('@')[0], passwordHash: 'x', role: 'sales' })
    .returning();
  return row;
}

async function stageBySlug(slug: string) {
  const [row] = await db
    .select()
    .from(schema.workflowStages)
    .where(eq(schema.workflowStages.slug, slug));
  return row;
}

/** An order parked in `artwork` (warn 48h / urgent 96h) since `enteredAt`. */
async function seedStuckOrder(enteredAt: Date) {
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
  await moveOrderToStage(created.orderId, 'artwork', {});
  await db
    .update(schema.orders)
    .set({ stageEnteredAt: enteredAt })
    .where(eq(schema.orders.id, created.orderId));
  return created.orderId;
}

describe('stuckDedupeKey', () => {
  // Day buckets are what stop an hourly scan nagging hourly: the claim ledger
  // sees the same key all day, then a fresh one tomorrow.
  it('is stable within a day and changes the next', () => {
    const morning = stuckDedupeKey('e1', 'artwork', new Date('2026-07-20T01:00:00Z'));
    const evening = stuckDedupeKey('e1', 'artwork', new Date('2026-07-20T23:00:00Z'));
    const tomorrow = stuckDedupeKey('e1', 'artwork', new Date('2026-07-21T01:00:00Z'));

    expect(morning).toBe(evening);
    expect(tomorrow).not.toBe(morning);
  });

  it('separates entities and stages', () => {
    expect(stuckDedupeKey('e1', 'artwork', NOW)).not.toBe(stuckDedupeKey('e2', 'artwork', NOW));
    expect(stuckDedupeKey('e1', 'artwork', NOW)).not.toBe(
      stuckDedupeKey('e1', 'digitising', NOW),
    );
  });
});

describe('runWorkflowScans — stuck work', () => {
  it('notifies the stage owner about a job past its warn threshold', async () => {
    const owner = await seedStaff('owner@x.com');
    const stage = await stageBySlug('artwork');
    await setAssignees('workflow_stage', stage.id, [owner.id], {});
    await seedStuckOrder(daysAgo(5));

    const result = await runWorkflowScans(NOW);

    expect(result.ran).toBe(true);
    expect(result.stuck).toBe(1);
    const items = await db.select().from(schema.inboxItems);
    expect(items).toHaveLength(1);
    expect(items[0].staffUserId).toBe(owner.id);
    expect(items[0].title).toMatch(/has been in artwork for 5 days/i);
  });

  it('leaves fresh work alone', async () => {
    const owner = await seedStaff('owner@x.com');
    const stage = await stageBySlug('artwork');
    await setAssignees('workflow_stage', stage.id, [owner.id], {});
    await seedStuckOrder(new Date(NOW.getTime() - 3_600_000));

    const result = await runWorkflowScans(NOW);

    expect(result.stuck).toBe(0);
    expect(await db.select().from(schema.inboxItems)).toHaveLength(0);
  });

  /**
   * The scheduler ticks hourly. Without day-bucketed dedupe the same stuck job
   * would notify 24 times a day, which is how people learn to filter the sender.
   */
  it('notifies once a day however often the scan runs', async () => {
    const owner = await seedStaff('owner@x.com');
    const stage = await stageBySlug('artwork');
    await setAssignees('workflow_stage', stage.id, [owner.id], {});
    await seedStuckOrder(daysAgo(5));

    await runWorkflowScans(new Date('2026-07-20T01:00:00Z'));
    await runWorkflowScans(new Date('2026-07-20T09:00:00Z'));
    await runWorkflowScans(new Date('2026-07-20T17:00:00Z'));

    expect(await db.select().from(schema.inboxItems)).toHaveLength(1);
  });

  it('notifies again the next day if it is still stuck', async () => {
    const owner = await seedStaff('owner@x.com');
    const stage = await stageBySlug('artwork');
    await setAssignees('workflow_stage', stage.id, [owner.id], {});
    await seedStuckOrder(daysAgo(5));

    await runWorkflowScans(new Date('2026-07-20T09:00:00Z'));
    await runWorkflowScans(new Date('2026-07-21T09:00:00Z'));

    expect(await db.select().from(schema.inboxItems)).toHaveLength(2);
  });

  it('escalates the wording once past the urgent threshold', async () => {
    const owner = await seedStaff('owner@x.com');
    const stage = await stageBySlug('artwork');
    await setAssignees('workflow_stage', stage.id, [owner.id], {});
    await seedStuckOrder(daysAgo(10));

    await runWorkflowScans(NOW);

    const [item] = await db.select().from(schema.inboxItems);
    expect(item.body).toMatch(/well past/i);
  });

  it('notifies nobody when the stage has no owner', async () => {
    await seedStuckOrder(daysAgo(5));

    const result = await runWorkflowScans(NOW);

    expect(result.stuck).toBe(1);
    expect(result.notified).toBe(0);
  });

  it('links to the order checklist', async () => {
    const owner = await seedStaff('owner@x.com');
    const stage = await stageBySlug('artwork');
    await setAssignees('workflow_stage', stage.id, [owner.id], {});
    const orderId = await seedStuckOrder(daysAgo(5));

    await runWorkflowScans(NOW);

    const [item] = await db.select().from(schema.inboxItems);
    expect(item.href).toBe(`/admin/orders/${orderId}?tab=checklist`);
  });
});

describe('snooze', () => {
  async function stuckWithOwner() {
    const owner = await seedStaff('owner@x.com');
    const stage = await stageBySlug('artwork');
    await setAssignees('workflow_stage', stage.id, [owner.id], {});
    const orderId = await seedStuckOrder(daysAgo(5));
    return { owner, orderId };
  }

  it('suppresses the nag for the person who snoozed', async () => {
    const { owner, orderId } = await stuckWithOwner();
    await upsertReminder('order', orderId, owner.id, 'snooze', daysAgo(-2));

    const result = await runWorkflowScans(NOW);

    expect(result.stuck).toBe(1);
    expect(result.notified).toBe(0);
  });

  // Per-user, so one person cannot silence a shared board for everyone.
  it('still notifies the other owners', async () => {
    const { owner, orderId } = await stuckWithOwner();
    const other = await seedStaff('other@x.com');
    const stage = await stageBySlug('artwork');
    await setAssignees('workflow_stage', stage.id, [owner.id, other.id], {});
    await upsertReminder('order', orderId, owner.id, 'snooze', daysAgo(-2));

    await runWorkflowScans(NOW);

    const items = await db.select().from(schema.inboxItems);
    expect(items.map((i) => i.staffUserId)).toEqual([other.id]);
  });

  it('stops suppressing once the snooze expires', async () => {
    const { owner, orderId } = await stuckWithOwner();
    await upsertReminder('order', orderId, owner.id, 'snooze', daysAgo(1));

    const result = await runWorkflowScans(NOW);

    expect(result.notified).toBe(1);
  });

  // Re-snoozing must extend in place, not stack rows that each fire later.
  it('extends an existing snooze rather than adding another', async () => {
    const { owner, orderId } = await stuckWithOwner();
    await upsertReminder('order', orderId, owner.id, 'snooze', daysAgo(-1));
    await upsertReminder('order', orderId, owner.id, 'snooze', daysAgo(-5));

    const rows = await db.select().from(schema.workflowReminders);
    expect(rows).toHaveLength(1);
    expect(rows[0].dueAt).toEqual(daysAgo(-5));
  });

  it('can be cleared', async () => {
    const { owner, orderId } = await stuckWithOwner();
    await upsertReminder('order', orderId, owner.id, 'snooze', daysAgo(-2));

    await clearReminder('order', orderId, owner.id, 'snooze');

    expect(await listRemindersForUser(owner.id)).toHaveLength(0);
    expect((await runWorkflowScans(NOW)).notified).toBe(1);
  });
});

describe('reminders', () => {
  async function orderWithReminder(dueAt: Date, note?: string) {
    const user = await seedStaff('user@x.com');
    const orderId = await seedStuckOrder(daysAgo(1));
    await upsertReminder('order', orderId, user.id, 'reminder', dueAt, note);
    return { user, orderId };
  }

  it('fires a reminder whose time has come, to whoever set it', async () => {
    const { user } = await orderWithReminder(daysAgo(1), 'chase the factory');

    const result = await runWorkflowScans(NOW);

    expect(result.remindersFired).toBe(1);
    const items = await db.select().from(schema.inboxItems);
    expect(items).toHaveLength(1);
    expect(items[0].staffUserId).toBe(user.id);
    expect(items[0].body).toBe('chase the factory');
  });

  it('leaves a future reminder alone', async () => {
    await orderWithReminder(daysAgo(-3));

    expect((await runWorkflowScans(NOW)).remindersFired).toBe(0);
  });

  // Resolved as it fires, so a later tick cannot fire it again.
  it('fires exactly once', async () => {
    await orderWithReminder(daysAgo(1));

    await runWorkflowScans(NOW);
    await runWorkflowScans(new Date(NOW.getTime() + 3_600_000));

    const items = await db
      .select()
      .from(schema.inboxItems)
      .where(eq(schema.inboxItems.eventKey, 'workflow.reminder'));
    expect(items).toHaveLength(1);
  });

  it('resolves the row when it fires', async () => {
    const { user } = await orderWithReminder(daysAgo(1));

    await runWorkflowScans(NOW);

    expect(await listRemindersForUser(user.id)).toHaveLength(0);
  });

  // A reminder is a note to yourself; no admin rule should redirect it.
  it('goes to the setter even though the catalog defines no rules for it', async () => {
    const { user } = await orderWithReminder(daysAgo(1));
    await seedStaff('someone-else@x.com');

    await runWorkflowScans(NOW);

    const items = await db
      .select()
      .from(schema.inboxItems)
      .where(eq(schema.inboxItems.eventKey, 'workflow.reminder'));
    expect(items.map((i) => i.staffUserId)).toEqual([user.id]);
  });

  it('names the order it is about', async () => {
    await orderWithReminder(daysAgo(1));

    await runWorkflowScans(NOW);

    const [item] = await db
      .select()
      .from(schema.inboxItems)
      .where(eq(schema.inboxItems.eventKey, 'workflow.reminder'));
    expect(item.title).toMatch(/^Reminder: OC-/);
  });
});

describe('runWorkflowScans — safety', () => {
  it('reports a clean run with nothing to do', async () => {
    const result = await runWorkflowScans(NOW);

    expect(result).toEqual({ ran: true, stuck: 0, remindersFired: 0, notified: 0 });
  });

  // A tick can be missed or retried; running twice must not double-notify.
  it('is safe to run twice in a row', async () => {
    const owner = await seedStaff('owner@x.com');
    const stage = await stageBySlug('artwork');
    await setAssignees('workflow_stage', stage.id, [owner.id], {});
    await seedStuckOrder(daysAgo(5));

    await runWorkflowScans(NOW);
    await runWorkflowScans(NOW);

    expect(await db.select().from(schema.inboxItems)).toHaveLength(1);
  });
});
