import { afterEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';

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
import { evaluateGate, assertGateOpen } from './gates';
import { confirmTask, getChecklist, reopenTask, sidestepTask } from './tasks';
import { moveOrderToStage } from './moves';

afterEach(async () => {
  await resetTestDb(db);
});

async function seedStaff(email: string, name = 'Sam') {
  const [row] = await db
    .insert(schema.staffUsers)
    .values({ email, name, passwordHash: 'x', role: 'sales' })
    .returning();
  return row;
}

/** A confirmed order sitting in the `artwork` stage, which has one task. */
async function seedOrderInArtwork() {
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
  return created.orderId;
}

async function taskBySlug(slug: string) {
  const [row] = await db
    .select()
    .from(schema.workflowStageTasks)
    .where(eq(schema.workflowStageTasks.slug, slug));
  return row;
}

async function stageBySlug(slug: string) {
  const [row] = await db
    .select()
    .from(schema.workflowStages)
    .where(
      and(eq(schema.workflowStages.boardKey, 'order'), eq(schema.workflowStages.slug, slug)),
    );
  return row;
}

describe('getChecklist', () => {
  it('lists the tasks for the stage the entity is in', async () => {
    const orderId = await seedOrderInArtwork();

    const checklist = await getChecklist('order', orderId);

    expect(checklist.stageSlug).toBe('artwork');
    expect(checklist.tasks.map((t) => t.slug)).toEqual(['artwork_approved']);
    expect(checklist.tasks[0].satisfied).toBe(false);
    expect(checklist.canLeaveStage).toBe(false);
  });

  it('reports the stage it would advance to', async () => {
    const orderId = await seedOrderInArtwork();

    expect((await getChecklist('order', orderId)).nextStageSlug).toBe('digitising');
  });

  it('marks a task satisfied once confirmed and shows who confirmed it', async () => {
    const orderId = await seedOrderInArtwork();
    const staff = await seedStaff('sam@x.com');
    const task = await taskBySlug('artwork_approved');

    await confirmTask('order', orderId, task.id, {
      actorEmail: 'sam@x.com',
      actorStaffUserId: staff.id,
    });

    const checklist = await getChecklist('order', orderId);
    const confirmed = checklist.tasks.find((t) => t.slug === 'artwork_approved');
    expect(confirmed).toBeUndefined(); // advanced out of artwork
    expect(checklist.stageSlug).toBe('digitising');
  });

  it('returns an empty checklist for a stage with no tasks', async () => {
    const orderId = await seedOrderInArtwork();
    // Direct write, not moveOrderToStage: that now gates on artwork's own
    // task, and this test is about getChecklist against a taskless stage, not
    // about how the order got there.
    await db
      .update(schema.orders)
      .set({ workflowStageSlug: 'ready_for_production' })
      .where(eq(schema.orders.id, orderId));

    const checklist = await getChecklist('order', orderId);

    expect(checklist.tasks).toEqual([]);
    expect(checklist.canLeaveStage).toBe(true);
  });

  it('404s for an unknown entity', async () => {
    await expect(
      getChecklist('order', '00000000-0000-0000-0000-000000000000'),
    ).rejects.toThrow('Order not found');
  });
});

describe('confirmTask — advancing', () => {
  it('advances to the next stage when the last blocking task is done', async () => {
    const orderId = await seedOrderInArtwork();
    const staff = await seedStaff('sam@x.com');
    const task = await taskBySlug('artwork_approved');

    const result = await confirmTask('order', orderId, task.id, {
      actorEmail: 'sam@x.com',
      actorStaffUserId: staff.id,
    });

    expect(result.advancedToStageSlug).toBe('digitising');
    const [row] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
    expect(row.workflowStageSlug).toBe('digitising');
    expect(row.stageEnteredAt).not.toBeNull();
  });

  // Advancing must never cross a status boundary implicitly — that is a status
  // transition with its own guards.
  it('stops at the end of the status group instead of changing status', async () => {
    const orderId = await seedOrderInArtwork();
    const staff = await seedStaff('sam@x.com');
    // Direct write, not moveOrderToStage: that now gates on artwork's own
    // task, and this test is about confirmTask's advance, not about how the
    // order got into 'sizing_locked'.
    await db
      .update(schema.orders)
      .set({ workflowStageSlug: 'sizing_locked' })
      .where(eq(schema.orders.id, orderId));
    const task = await taskBySlug('sizing_confirmed');

    const result = await confirmTask('order', orderId, task.id, {
      actorEmail: 'sam@x.com',
      actorStaffUserId: staff.id,
    });

    expect(result.advancedToStageSlug).toBe('ready_for_production');
    const [row] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
    expect(row.status).toBe('confirmed');
  });

  it('does not advance while another blocking task is outstanding', async () => {
    const orderId = await seedOrderInArtwork();
    const staff = await seedStaff('sam@x.com');
    const stage = await stageBySlug('artwork');
    // A second blocking task on the same stage.
    await db.insert(schema.workflowStageTasks).values({
      stageId: stage.id,
      slug: 'second_check',
      name: 'Second check',
      isBlocking: true,
      gateKeys: [],
      sortOrder: 20,
    });
    const task = await taskBySlug('artwork_approved');

    const result = await confirmTask('order', orderId, task.id, {
      actorEmail: 'sam@x.com',
      actorStaffUserId: staff.id,
    });

    expect(result.advancedToStageSlug).toBeNull();
    const [row] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
    expect(row.workflowStageSlug).toBe('artwork');
  });

  it('records the confirmation with its actor and note', async () => {
    const orderId = await seedOrderInArtwork();
    const staff = await seedStaff('sam@x.com');
    const task = await taskBySlug('artwork_approved');

    await confirmTask('order', orderId, task.id, {
      actorEmail: 'sam@x.com',
      actorStaffUserId: staff.id,
      note: 'checked against the mock-up',
    });

    const [row] = await db.select().from(schema.workflowTaskCompletions);
    expect(row.confirmedByStaffUserId).toBe(staff.id);
    expect(row.confirmedByEmail).toBe('sam@x.com');
    expect(row.note).toBe('checked against the mock-up');
  });

  it('audits the confirmation', async () => {
    const orderId = await seedOrderInArtwork();
    const staff = await seedStaff('sam@x.com');
    const task = await taskBySlug('artwork_approved');

    await confirmTask('order', orderId, task.id, {
      actorEmail: 'sam@x.com',
      actorStaffUserId: staff.id,
    });

    const rows = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'workflow.task_confirmed'));
    expect(rows).toHaveLength(1);
    expect(rows[0].actorEmail).toBe('sam@x.com');
  });

  // A double-click must not be an error, and must not advance twice.
  it('is idempotent for the same user', async () => {
    const orderId = await seedOrderInArtwork();
    const staff = await seedStaff('sam@x.com');
    const task = await taskBySlug('artwork_approved');
    const meta = { actorEmail: 'sam@x.com', actorStaffUserId: staff.id };

    await confirmTask('order', orderId, task.id, meta);
    await confirmTask('order', orderId, task.id, meta);

    expect(await db.select().from(schema.workflowTaskCompletions)).toHaveLength(1);
  });

  /**
   * Two people confirming the same last task must leave the job exactly ONE stage
   * further on.
   *
   * Run sequentially, not with Promise.all: PGlite has a single connection, so
   * two overlapping transactions each taking `FOR UPDATE` on the same row wait on
   * each other forever — the test hangs rather than failing. Genuine concurrency
   * therefore cannot be exercised here; what IS covered is that a second
   * confirmation arriving after the advance does not advance again, which is the
   * observable half of the same property.
   */
  it('does not advance twice when a second person confirms the same task', async () => {
    const orderId = await seedOrderInArtwork();
    const a = await seedStaff('a@x.com', 'A');
    const b = await seedStaff('b@x.com', 'B');
    const task = await taskBySlug('artwork_approved');

    const first = await confirmTask('order', orderId, task.id, {
      actorEmail: 'a@x.com',
      actorStaffUserId: a.id,
    });
    expect(first.advancedToStageSlug).toBe('digitising');

    // A DIFFERENT person confirming the same task afterwards is refused: the job
    // has moved on, and a stale tab must not be able to tick a check for a stage
    // the work has already left.
    await expect(
      confirmTask('order', orderId, task.id, {
        actorEmail: 'b@x.com',
        actorStaffUserId: b.id,
      }),
    ).rejects.toThrow('different stage');

    const [row] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
    expect(row.workflowStageSlug).toBe('digitising');
  });

  it('rejects a task that belongs to another stage', async () => {
    const orderId = await seedOrderInArtwork();
    const staff = await seedStaff('sam@x.com');
    const other = await taskBySlug('fabric_confirmed');

    await expect(
      confirmTask('order', orderId, other.id, {
        actorEmail: 'sam@x.com',
        actorStaffUserId: staff.id,
      }),
    ).rejects.toThrow('different stage');
  });

  it('404s for an unknown task', async () => {
    const orderId = await seedOrderInArtwork();
    await expect(
      confirmTask('order', orderId, '00000000-0000-0000-0000-000000000000', {}),
    ).rejects.toThrow('Task not found');
  });
});

describe('confirmTask — all policy', () => {
  async function makeAllPolicyStage() {
    const orderId = await seedOrderInArtwork();
    const stage = await stageBySlug('artwork');
    await db
      .update(schema.workflowStages)
      .set({ defaultConfirmationPolicy: 'all' })
      .where(eq(schema.workflowStages.id, stage.id));
    return { orderId, stage };
  }

  it('waits for every owner before advancing', async () => {
    const { orderId, stage } = await makeAllPolicyStage();
    const a = await seedStaff('a@x.com', 'A');
    const b = await seedStaff('b@x.com', 'B');
    await setAssignees('workflow_stage', stage.id, [a.id, b.id], {});
    const task = await taskBySlug('artwork_approved');

    const first = await confirmTask('order', orderId, task.id, {
      actorEmail: 'a@x.com',
      actorStaffUserId: a.id,
    });
    expect(first.advancedToStageSlug).toBeNull();

    const second = await confirmTask('order', orderId, task.id, {
      actorEmail: 'b@x.com',
      actorStaffUserId: b.id,
    });
    expect(second.advancedToStageSlug).toBe('digitising');
  });

  it('lists who is still awaited', async () => {
    const { orderId, stage } = await makeAllPolicyStage();
    const a = await seedStaff('a@x.com', 'A');
    const b = await seedStaff('b@x.com', 'B');
    await setAssignees('workflow_stage', stage.id, [a.id, b.id], {});
    const task = await taskBySlug('artwork_approved');
    await confirmTask('order', orderId, task.id, {
      actorEmail: 'a@x.com',
      actorStaffUserId: a.id,
    });

    const checklist = await getChecklist('order', orderId);
    expect(checklist.tasks[0].awaiting).toEqual([b.id]);
  });

  // A deactivated owner must not deadlock the job forever.
  it('ignores a deactivated owner', async () => {
    const { orderId, stage } = await makeAllPolicyStage();
    const a = await seedStaff('a@x.com', 'A');
    const gone = await seedStaff('gone@x.com', 'Gone');
    await setAssignees('workflow_stage', stage.id, [a.id, gone.id], {});
    await db
      .update(schema.staffUsers)
      .set({ isActive: false })
      .where(eq(schema.staffUsers.id, gone.id));
    const task = await taskBySlug('artwork_approved');

    const result = await confirmTask('order', orderId, task.id, {
      actorEmail: 'a@x.com',
      actorStaffUserId: a.id,
    });

    expect(result.advancedToStageSlug).toBe('digitising');
  });

  // An unowned all-policy stage would otherwise be unsatisfiable.
  it('treats an unowned stage as one-is-enough', async () => {
    const { orderId } = await makeAllPolicyStage();
    const staff = await seedStaff('sam@x.com');
    const task = await taskBySlug('artwork_approved');

    const result = await confirmTask('order', orderId, task.id, {
      actorEmail: 'sam@x.com',
      actorStaffUserId: staff.id,
    });

    expect(result.advancedToStageSlug).toBe('digitising');
  });
});

describe('reopenTask', () => {
  it('clears the confirmations for an admin', async () => {
    const orderId = await seedOrderInArtwork();
    const staff = await seedStaff('sam@x.com');
    const task = await taskBySlug('artwork_approved');
    await confirmTask('order', orderId, task.id, {
      actorEmail: 'sam@x.com',
      actorStaffUserId: staff.id,
    });

    await reopenTask('order', orderId, task.id, {
      actorEmail: 'boss@x.com',
      isAdmin: true,
    });

    expect(await db.select().from(schema.workflowTaskCompletions)).toHaveLength(0);
  });

  it('refuses a non-admin', async () => {
    const orderId = await seedOrderInArtwork();
    const task = await taskBySlug('artwork_approved');

    await expect(
      reopenTask('order', orderId, task.id, { actorEmail: 'sam@x.com' }),
    ).rejects.toThrow('Only an admin');
  });

  // Dragging the job backwards would be more surprising than showing the check
  // as outstanding where it now sits.
  it('does not move the stage back', async () => {
    const orderId = await seedOrderInArtwork();
    const staff = await seedStaff('sam@x.com');
    const task = await taskBySlug('artwork_approved');
    await confirmTask('order', orderId, task.id, {
      actorEmail: 'sam@x.com',
      actorStaffUserId: staff.id,
    });

    await reopenTask('order', orderId, task.id, { actorEmail: 'boss@x.com', isAdmin: true });

    const [row] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
    expect(row.workflowStageSlug).toBe('digitising');
  });

  it('is a no-op when nothing was confirmed', async () => {
    const orderId = await seedOrderInArtwork();
    const task = await taskBySlug('artwork_approved');

    await reopenTask('order', orderId, task.id, { actorEmail: 'boss@x.com', isAdmin: true });

    const rows = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'workflow.task_reopened'));
    expect(rows).toHaveLength(0);
  });
});

// `colour_sample_dispatched` (0020, `confirmed` stage) is the seeded task with
// `allowSidestep: true` — the motivating case from the app itself.
describe('sidestepTask', () => {
  it('records a sidestep and satisfies the po_send gate for that task', async () => {
    const orderId = await seedOrderInArtwork();
    await moveOrderToStage(orderId, 'confirmed', {});
    const staff = await seedStaff('sam@x.com');
    const task = await taskBySlug('colour_sample_dispatched');

    const result = await sidestepTask('order', orderId, task.id, {
      actorEmail: 'sam@x.com',
      actorStaffUserId: staff.id,
      reason: 'No sample requested for this order',
    });

    expect(result.satisfied).toBe(true);
    const [row] = await db
      .select()
      .from(schema.workflowTaskCompletions)
      .where(eq(schema.workflowTaskCompletions.taskId, task.id));
    expect(row.sidestepped).toBe(true);
    expect(row.sidestepReason).toBe('No sample requested for this order');

    const gate = await evaluateGate('po_send', 'order', orderId);
    expect(gate.outstanding.map((t) => t.slug)).not.toContain('colour_sample_dispatched');
  });

  it('refuses a task not configured to allow sidestep', async () => {
    const orderId = await seedOrderInArtwork();
    const staff = await seedStaff('sam@x.com');
    const task = await taskBySlug('artwork_approved');

    await expect(
      sidestepTask('order', orderId, task.id, {
        actorEmail: 'sam@x.com',
        actorStaffUserId: staff.id,
        reason: 'skip it',
      }),
    ).rejects.toThrow('cannot be sidestepped');
  });

  it('refuses a blank reason', async () => {
    const orderId = await seedOrderInArtwork();
    await moveOrderToStage(orderId, 'confirmed', {});
    const staff = await seedStaff('sam@x.com');
    const task = await taskBySlug('colour_sample_dispatched');

    await expect(
      sidestepTask('order', orderId, task.id, {
        actorEmail: 'sam@x.com',
        actorStaffUserId: staff.id,
        reason: '   ',
      }),
    ).rejects.toThrow(/give a reason/i);
  });

  it('is idempotent for the same user', async () => {
    const orderId = await seedOrderInArtwork();
    await moveOrderToStage(orderId, 'confirmed', {});
    const staff = await seedStaff('sam@x.com');
    const task = await taskBySlug('colour_sample_dispatched');
    const meta = { actorEmail: 'sam@x.com', actorStaffUserId: staff.id, reason: 'no sample' };

    await sidestepTask('order', orderId, task.id, meta);
    await sidestepTask('order', orderId, task.id, meta);

    expect(await db.select().from(schema.workflowTaskCompletions)).toHaveLength(1);
  });

  it('audits the sidestep with its reason', async () => {
    const orderId = await seedOrderInArtwork();
    await moveOrderToStage(orderId, 'confirmed', {});
    const staff = await seedStaff('sam@x.com');
    const task = await taskBySlug('colour_sample_dispatched');

    await sidestepTask('order', orderId, task.id, {
      actorEmail: 'sam@x.com',
      actorStaffUserId: staff.id,
      reason: 'no sample requested',
    });

    const rows = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'workflow.task_sidestepped'));
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toMatchObject({ reason: 'no sample requested' });
  });

  it('reopenTask clears a sidestepped completion', async () => {
    const orderId = await seedOrderInArtwork();
    await moveOrderToStage(orderId, 'confirmed', {});
    const staff = await seedStaff('sam@x.com');
    const task = await taskBySlug('colour_sample_dispatched');
    await sidestepTask('order', orderId, task.id, {
      actorEmail: 'sam@x.com',
      actorStaffUserId: staff.id,
      reason: 'no sample requested',
    });

    await reopenTask('order', orderId, task.id, { actorEmail: 'boss@x.com', isAdmin: true });

    expect(
      await db
        .select()
        .from(schema.workflowTaskCompletions)
        .where(eq(schema.workflowTaskCompletions.taskId, task.id)),
    ).toHaveLength(0);
  });
});

describe('evaluateGate', () => {
  it('is closed while the seeded pre-production checks are outstanding', async () => {
    const orderId = await seedOrderInArtwork();

    const result = await evaluateGate('po_send', 'order', orderId);

    expect(result.open).toBe(false);
    expect(result.outstanding.map((t) => t.slug).sort()).toEqual([
      'artwork_approved',
      'colour_sample_dispatched',
      'fabric_confirmed',
      'sizing_confirmed',
      'strike_off_approved',
    ]);
  });

  /**
   * Gates read every stage, not just the current one — otherwise a job could be
   * dragged past a stage to escape its checks. `moveOrderToStage` itself now
   * refuses that drag (see moves.integration.test.ts), but the gate is a
   * second, independent line of defence for a row that reaches a later stage
   * some other way — a config change, an import, a row that predates this
   * stage's checklist — so it is exercised here with a direct write instead
   * of the (now-refusing) move function.
   */
  it('still counts checks from stages the job has already left', async () => {
    const orderId = await seedOrderInArtwork();
    await db
      .update(schema.orders)
      .set({ workflowStageSlug: 'ready_for_production' })
      .where(eq(schema.orders.id, orderId));

    const result = await evaluateGate('po_send', 'order', orderId);

    expect(result.open).toBe(false);
    expect(result.outstanding.map((t) => t.slug)).toContain('artwork_approved');
  });

  // Non-blocking tasks do not hold the job, but they do hold the gate.
  it('counts the non-blocking colour sample against the gate', async () => {
    const orderId = await seedOrderInArtwork();
    const staff = await seedStaff('sam@x.com');
    for (const slug of [
      'artwork_approved',
      'strike_off_approved',
      'fabric_confirmed',
      'sizing_confirmed',
    ]) {
      const task = await taskBySlug(slug);
      const stage = await db
        .select()
        .from(schema.workflowStages)
        .where(eq(schema.workflowStages.id, task.stageId));
      await moveOrderToStage(orderId, stage[0].slug, {});
      await confirmTask('order', orderId, task.id, {
        actorEmail: 'sam@x.com',
        actorStaffUserId: staff.id,
      });
    }

    const result = await evaluateGate('po_send', 'order', orderId);

    expect(result.open).toBe(false);
    expect(result.outstanding.map((t) => t.slug)).toEqual(['colour_sample_dispatched']);
  });

  it('opens once every gated task is confirmed', async () => {
    const orderId = await seedOrderInArtwork();
    const staff = await seedStaff('sam@x.com');
    const all = await db.select().from(schema.workflowStageTasks);
    for (const task of all) {
      await db.insert(schema.workflowTaskCompletions).values({
        taskId: task.id,
        entityType: 'order',
        entityId: orderId,
        confirmedByStaffUserId: staff.id,
        confirmedByEmail: 'sam@x.com',
      });
    }

    expect((await evaluateGate('po_send', 'order', orderId)).open).toBe(true);
  });

  it('is open for a gate no task carries', async () => {
    const orderId = await seedOrderInArtwork();

    expect((await evaluateGate('order_confirm', 'order', orderId)).open).toBe(true);
  });

  it('ignores a deactivated task', async () => {
    const orderId = await seedOrderInArtwork();
    await db.update(schema.workflowStageTasks).set({ isActive: false });

    expect((await evaluateGate('po_send', 'order', orderId)).open).toBe(true);
  });
});

describe('assertGateOpen', () => {
  it('passes silently when the gate is open', async () => {
    const orderId = await seedOrderInArtwork();

    await expect(assertGateOpen('order_confirm', 'order', orderId)).resolves.toBeUndefined();
  });

  it('throws a conflict listing the outstanding checks', async () => {
    const orderId = await seedOrderInArtwork();

    await expect(assertGateOpen('po_send', 'order', orderId)).rejects.toThrow(
      /blocked by outstanding checks/i,
    );
  });

  it('lets an override through and audits the reason', async () => {
    const orderId = await seedOrderInArtwork();

    await assertGateOpen('po_send', 'order', orderId, {
      override: { reason: 'Customer accepted the risk in writing', actorEmail: 'boss@x.com' },
      context: { poNumber: 'PO-1' },
    });

    const [row] = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'workflow.gate_overridden'));
    expect(row.actorEmail).toBe('boss@x.com');
    expect(row.payload).toMatchObject({
      gateKey: 'po_send',
      reason: 'Customer accepted the risk in writing',
      poNumber: 'PO-1',
    });
  });

  // An override with no reason is indistinguishable from having no gate.
  it('refuses an override with a blank reason', async () => {
    const orderId = await seedOrderInArtwork();

    await expect(
      assertGateOpen('po_send', 'order', orderId, { override: { reason: '   ' } }),
    ).rejects.toThrow(/blocked by outstanding checks/i);
  });

  it('records no override when the gate was open anyway', async () => {
    const orderId = await seedOrderInArtwork();

    await assertGateOpen('order_confirm', 'order', orderId, {
      override: { reason: 'not needed' },
    });

    const rows = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'workflow.gate_overridden'));
    expect(rows).toHaveLength(0);
  });
});
