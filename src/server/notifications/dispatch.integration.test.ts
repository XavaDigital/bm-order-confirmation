import type { StaffRole } from '@/lib/roles';
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
import { setAssignees } from '@/server/workflow/assignments';
import {
  dispatchNotification,
  getUnreadCount,
  listInbox,
  markInboxRead,
  resolveRecipients,
} from './dispatch';

afterEach(async () => {
  await resetTestDb(db);
});

async function seedStaff(email: string, role: StaffRole = 'sales', isActive = true) {
  const [row] = await db
    .insert(schema.staffUsers)
    .values({ email, name: email.split('@')[0], passwordHash: 'x', role, isActive })
    .returning();
  return row;
}

async function seedOrder(createdBy?: string) {
  const created = await createOrder(
    createOrderSchema.parse({
      customer: { name: 'Jane Coach', email: 'jane@example.com' },
      garments: [{ name: 'Home Jersey' }],
    }),
    createdBy,
  );
  return created.orderId;
}

async function stageBySlug(slug: string) {
  const [row] = await db
    .select()
    .from(schema.workflowStages)
    .where(eq(schema.workflowStages.slug, slug));
  return row;
}

const base = { dedupeKey: 'event-1', title: 'Something happened' };

describe('resolveRecipients', () => {
  it('resolves a role rule to active users with that role', async () => {
    const admin = await seedStaff('admin@x.com', 'admin');
    await seedStaff('sales@x.com', 'sales');

    const people = await resolveRecipients([{ kind: 'role', roleKey: 'admin' }], base);

    expect(people.map((p) => p.staffUserId)).toEqual([admin.id]);
  });

  it('resolves specific users', async () => {
    const a = await seedStaff('a@x.com');
    await seedStaff('b@x.com');

    const people = await resolveRecipients(
      [{ kind: 'specific_users', staffUserIds: [a.id] }],
      base,
    );

    expect(people.map((p) => p.staffUserId)).toEqual([a.id]);
  });

  it('resolves stage owners for the stage in context', async () => {
    const owner = await seedStaff('owner@x.com');
    const stage = await stageBySlug('artwork');
    await setAssignees('workflow_stage', stage.id, [owner.id], {});

    const people = await resolveRecipients([{ kind: 'stage_owners' }], {
      ...base,
      stageSlug: 'artwork',
      boardKey: 'order',
    });

    expect(people.map((p) => p.staffUserId)).toEqual([owner.id]);
  });

  it('resolves nobody for stage_owners without a stage in context', async () => {
    const owner = await seedStaff('owner@x.com');
    const stage = await stageBySlug('artwork');
    await setAssignees('workflow_stage', stage.id, [owner.id], {});

    expect(await resolveRecipients([{ kind: 'stage_owners' }], base)).toEqual([]);
  });

  it('resolves the order owner from createdBy', async () => {
    const creator = await seedStaff('creator@x.com');
    const orderId = await seedOrder(creator.id);

    const people = await resolveRecipients([{ kind: 'order_owner' }], {
      ...base,
      entityType: 'order',
      entityId: orderId,
    });

    expect(people.map((p) => p.staffUserId)).toEqual([creator.id]);
  });

  // Today's behaviour when createdBy is null is "nobody is told". Under rules an
  // admin can add a role rule to close that hole without a code change.
  it('resolves nobody when the order has no creator', async () => {
    const orderId = await seedOrder();

    const people = await resolveRecipients([{ kind: 'order_owner' }], {
      ...base,
      entityType: 'order',
      entityId: orderId,
    });

    expect(people).toEqual([]);
  });

  it('resolves entity assignees', async () => {
    const assignee = await seedStaff('assignee@x.com');
    const orderId = await seedOrder();
    await setAssignees('order', orderId, [assignee.id], {});

    const people = await resolveRecipients([{ kind: 'entity_assignees' }], {
      ...base,
      entityType: 'order',
      entityId: orderId,
    });

    expect(people.map((p) => p.staffUserId)).toEqual([assignee.id]);
  });

  it('deduplicates a person matched by two rules', async () => {
    const person = await seedStaff('both@x.com', 'admin');
    const orderId = await seedOrder(person.id);

    const people = await resolveRecipients(
      [{ kind: 'role', roleKey: 'admin' }, { kind: 'order_owner' }],
      { ...base, entityType: 'order', entityId: orderId },
    );

    expect(people).toHaveLength(1);
  });

  // Nobody needs telling about something they just did.
  it('drops the actor', async () => {
    const actor = await seedStaff('actor@x.com', 'admin');
    await seedStaff('other@x.com', 'admin');

    const people = await resolveRecipients([{ kind: 'role', roleKey: 'admin' }], {
      ...base,
      actorStaffUserId: actor.id,
    });

    expect(people.map((p) => p.email)).toEqual(['other@x.com']);
  });

  it('drops explicitly excluded people, so two handlers do not both tell them', async () => {
    const a = await seedStaff('a@x.com', 'admin');
    const b = await seedStaff('b@x.com', 'admin');

    const people = await resolveRecipients([{ kind: 'role', roleKey: 'admin' }], {
      ...base,
      excludeStaffUserIds: [a.id],
    });

    expect(people.map((p) => p.staffUserId)).toEqual([b.id]);
  });

  it('drops deactivated users', async () => {
    await seedStaff('gone@x.com', 'admin', false);

    expect(await resolveRecipients([{ kind: 'role', roleKey: 'admin' }], base)).toEqual([]);
  });
});

describe('dispatchNotification', () => {
  it('writes an inbox item for each recipient', async () => {
    const owner = await seedStaff('owner@x.com');
    const stage = await stageBySlug('artwork');
    await setAssignees('workflow_stage', stage.id, [owner.id], {});

    const result = await dispatchNotification('workflow.stage_entered', {
      dedupeKey: 'evt-1',
      stageSlug: 'artwork',
      boardKey: 'order',
      title: 'Work has reached Artwork',
      href: '/admin/orders/x?tab=checklist',
    });

    expect(result.notified).toEqual([owner.id]);
    const items = await db.select().from(schema.inboxItems);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Work has reached Artwork');
    expect(items[0].href).toBe('/admin/orders/x?tab=checklist');
  });

  /**
   * The property the whole ledger exists for. The outbox re-runs every handler
   * for an event on retry, so without claim-before-send one flaky SMTP call
   * would notify the same people again on every backoff attempt.
   */
  it('notifies nobody a second time when the same event is re-processed', async () => {
    const owner = await seedStaff('owner@x.com');
    const stage = await stageBySlug('artwork');
    await setAssignees('workflow_stage', stage.id, [owner.id], {});
    const context = {
      dedupeKey: 'evt-1',
      stageSlug: 'artwork',
      boardKey: 'order' as const,
      title: 'Work has reached Artwork',
    };

    const first = await dispatchNotification('workflow.stage_entered', context);
    const second = await dispatchNotification('workflow.stage_entered', context);
    const third = await dispatchNotification('workflow.stage_entered', context);

    expect(first.notified).toHaveLength(1);
    expect(second.notified).toHaveLength(0);
    expect(third.notified).toHaveLength(0);
    expect(await db.select().from(schema.inboxItems)).toHaveLength(1);
  });

  it('does notify again for a genuinely different event', async () => {
    const owner = await seedStaff('owner@x.com');
    const stage = await stageBySlug('artwork');
    await setAssignees('workflow_stage', stage.id, [owner.id], {});
    const context = { stageSlug: 'artwork', boardKey: 'order' as const, title: 'x' };

    await dispatchNotification('workflow.stage_entered', { ...context, dedupeKey: 'evt-1' });
    await dispatchNotification('workflow.stage_entered', { ...context, dedupeKey: 'evt-2' });

    expect(await db.select().from(schema.inboxItems)).toHaveLength(2);
  });

  it('records the claim as sent', async () => {
    const owner = await seedStaff('owner@x.com');
    const stage = await stageBySlug('artwork');
    await setAssignees('workflow_stage', stage.id, [owner.id], {});

    await dispatchNotification('workflow.stage_entered', {
      dedupeKey: 'evt-1',
      stageSlug: 'artwork',
      boardKey: 'order',
      title: 'x',
    });

    const [claim] = await db.select().from(schema.notificationDeliveries);
    expect(claim.channel).toBe('inbox');
    expect(claim.sentAt).not.toBeNull();
  });

  it('stages an email only when email is enabled for that event', async () => {
    const owner = await seedStaff('owner@x.com');
    const stage = await stageBySlug('artwork');
    await setAssignees('workflow_stage', stage.id, [owner.id], {});

    // stage_entered defaults to email on.
    await dispatchNotification('workflow.stage_entered', {
      dedupeKey: 'evt-1',
      stageSlug: 'artwork',
      boardKey: 'order',
      title: 'x',
    });
    const [withEmail] = await db.select().from(schema.inboxItems);
    expect(withEmail.emailSubject).toBe('x');

    // order.note_added defaults to in-app only — notes are chatty.
    const orderId = await seedOrder(owner.id);
    await dispatchNotification('order.note_added', {
      dedupeKey: 'evt-2',
      entityType: 'order',
      entityId: orderId,
      title: 'note',
    });
    const items = await db.select().from(schema.inboxItems);
    const noteItem = items.find((i) => i.eventKey === 'order.note_added')!;
    expect(noteItem.emailSubject).toBeNull();
  });

  it('respects a disabled override', async () => {
    const owner = await seedStaff('owner@x.com');
    const stage = await stageBySlug('artwork');
    await setAssignees('workflow_stage', stage.id, [owner.id], {});
    await db
      .insert(schema.notificationEventSettings)
      .values({ eventKey: 'workflow.stage_entered', enabled: false });

    const result = await dispatchNotification('workflow.stage_entered', {
      dedupeKey: 'evt-1',
      stageSlug: 'artwork',
      boardKey: 'order',
      title: 'x',
    });

    expect(result.skipped).toBe('disabled');
    expect(await db.select().from(schema.inboxItems)).toHaveLength(0);
  });

  // Config is override-only: with no rows at all, the code defaults apply.
  it('uses the code defaults when nothing is configured', async () => {
    const owner = await seedStaff('owner@x.com');
    const stage = await stageBySlug('artwork');
    await setAssignees('workflow_stage', stage.id, [owner.id], {});

    const result = await dispatchNotification('workflow.stage_entered', {
      dedupeKey: 'evt-1',
      stageSlug: 'artwork',
      boardKey: 'order',
      title: 'x',
    });

    expect(result.notified).toEqual([owner.id]);
  });

  it('a configured rule replaces the defaults', async () => {
    const owner = await seedStaff('owner@x.com');
    const admin = await seedStaff('admin@x.com', 'admin');
    const stage = await stageBySlug('artwork');
    await setAssignees('workflow_stage', stage.id, [owner.id], {});
    await db
      .insert(schema.notificationRecipientRules)
      .values({ eventKey: 'workflow.stage_entered', kind: 'role', roleKey: 'admin' });

    const result = await dispatchNotification('workflow.stage_entered', {
      dedupeKey: 'evt-1',
      stageSlug: 'artwork',
      boardKey: 'order',
      title: 'x',
    });

    expect(result.notified).toEqual([admin.id]);
  });

  it('reports an unknown key rather than throwing', async () => {
    const result = await dispatchNotification('not.a.real.event', {
      dedupeKey: 'evt-1',
      title: 'x',
    });

    expect(result.skipped).toBe('unknown-key');
  });

  it('reports having nobody to tell', async () => {
    const result = await dispatchNotification('workflow.stage_entered', {
      dedupeKey: 'evt-1',
      stageSlug: 'artwork',
      boardKey: 'order',
      title: 'x',
    });

    expect(result.skipped).toBe('no-recipients');
  });

  it('escapes the title in the staged email body', async () => {
    const owner = await seedStaff('owner@x.com');
    const stage = await stageBySlug('artwork');
    await setAssignees('workflow_stage', stage.id, [owner.id], {});

    await dispatchNotification('workflow.stage_entered', {
      dedupeKey: 'evt-1',
      stageSlug: 'artwork',
      boardKey: 'order',
      title: '<script>alert(1)</script>',
    });

    const [item] = await db.select().from(schema.inboxItems);
    expect(item.emailHtml).not.toContain('<script>');
    expect(item.emailHtml).toContain('&lt;script&gt;');
  });
});

describe('inbox reads', () => {
  async function seedInbox(staffUserId: string, count: number) {
    for (let i = 0; i < count; i += 1) {
      await db.insert(schema.inboxItems).values({
        staffUserId,
        eventKey: 'workflow.stage_entered',
        title: `Item ${i}`,
      });
    }
  }

  it('counts only unread items', async () => {
    const user = await seedStaff('user@x.com');
    await seedInbox(user.id, 3);

    expect(await getUnreadCount(user.id)).toBe(3);
    await markInboxRead(user.id);
    expect(await getUnreadCount(user.id)).toBe(0);
  });

  it('never counts another user’s items', async () => {
    const mine = await seedStaff('mine@x.com');
    const theirs = await seedStaff('theirs@x.com');
    await seedInbox(theirs.id, 5);

    expect(await getUnreadCount(mine.id)).toBe(0);
  });

  it('lists newest first', async () => {
    const user = await seedStaff('user@x.com');
    await seedInbox(user.id, 3);

    const items = await listInbox(user.id);

    expect(items[0].title).toBe('Item 2');
  });

  it('can list unread only', async () => {
    const user = await seedStaff('user@x.com');
    await seedInbox(user.id, 2);
    const all = await listInbox(user.id);
    await markInboxRead(user.id, [all[0].id]);

    expect(await listInbox(user.id, { unreadOnly: true })).toHaveLength(1);
  });

  it('marks only the named items read', async () => {
    const user = await seedStaff('user@x.com');
    await seedInbox(user.id, 3);
    const items = await listInbox(user.id);

    const marked = await markInboxRead(user.id, [items[0].id]);

    expect(marked).toBe(1);
    expect(await getUnreadCount(user.id)).toBe(2);
  });

  // Scoped to the caller, so one user cannot clear another's inbox.
  it('refuses to mark another user’s item read', async () => {
    const mine = await seedStaff('mine@x.com');
    const theirs = await seedStaff('theirs@x.com');
    await seedInbox(theirs.id, 1);
    const theirItems = await listInbox(theirs.id);

    const marked = await markInboxRead(mine.id, [theirItems[0].id]);

    expect(marked).toBe(0);
    expect(await getUnreadCount(theirs.id)).toBe(1);
  });

  it('is idempotent when marking already-read items', async () => {
    const user = await seedStaff('user@x.com');
    await seedInbox(user.id, 2);

    expect(await markInboxRead(user.id)).toBe(2);
    expect(await markInboxRead(user.id)).toBe(0);
  });
});
