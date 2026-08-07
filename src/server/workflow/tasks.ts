/**
 * Task confirmation, and the advance it can trigger.
 *
 * The whole operation is ONE transaction with the entity row locked: two people
 * clicking "done" on the last outstanding task at the same moment must produce
 * one advance, not two. The pure rules live in `task-rules.ts`; this module is
 * the part that touches the database.
 */
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { db, type Transaction } from '@/db';
import {
  orders,
  purchaseOrders,
  workflowStageTasks,
  workflowTaskCompletions,
} from '@/db/schema';
import type { ConfirmationPolicy, WorkflowBoardKey } from '@/db/schema';
import { ConflictError, NotFoundError } from '@/server/orders/service';
import { emitOrderEvent, recordAuditEvent } from '@/server/events/outbox';
import { listActiveStages, resolveStage, type StageRow } from './stages';
import { getStageOwnerIdsForMany } from './assignments';
import {
  canLeaveStage,
  isTaskSatisfied,
  nextStageInGroup,
  policyFor,
  type CompletionShape,
  type StageExitCheck,
  type TaskShape,
} from './task-rules';

type ActorMeta = {
  actorEmail?: string | null;
  actorStaffUserId?: string | null;
  isAdmin?: boolean;
};

export interface ChecklistTask {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  isBlocking: boolean;
  policy: ConfirmationPolicy;
  gateKeys: string[];
  satisfied: boolean;
  confirmations: Array<{
    staffUserId: string | null;
    email: string | null;
    confirmedAt: string;
    note: string | null;
  }>;
  /** Owners still to confirm — only meaningful under an `all` policy. */
  awaiting: string[];
  /** May this task be acknowledged past instead of done? */
  allowSidestep: boolean;
  /** True when what satisfies it (at least in part) is a sidestep, not a tick. */
  sidestepped: boolean;
  sidestepReason: string | null;
}

export interface Checklist {
  entityType: WorkflowBoardKey;
  entityId: string;
  stageSlug: string | null;
  stageName: string | null;
  tasks: ChecklistTask[];
  canLeaveStage: boolean;
  nextStageSlug: string | null;
}

function toTaskShape(row: typeof workflowStageTasks.$inferSelect): TaskShape {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    isBlocking: row.isBlocking,
    confirmationPolicy: row.confirmationPolicy,
    gateKeys: row.gateKeys,
  };
}

/** Load an entity's current status and recorded stage slug. */
async function loadEntity(
  entityType: WorkflowBoardKey,
  entityId: string,
): Promise<{ status: string; workflowStageSlug: string | null }> {
  if (entityType === 'order') {
    const row = await db.query.orders.findFirst({
      where: eq(orders.id, entityId),
      columns: { status: true, workflowStageSlug: true },
    });
    if (!row) throw new NotFoundError('Order');
    return row;
  }
  const row = await db.query.purchaseOrders.findFirst({
    where: eq(purchaseOrders.id, entityId),
    columns: { status: true, workflowStageSlug: true },
  });
  if (!row) throw new NotFoundError('Purchase order');
  return row;
}

async function loadCompletions(
  entityType: WorkflowBoardKey,
  entityId: string,
  taskIds: string[],
): Promise<Map<string, CompletionShape[]>> {
  const map = new Map<string, CompletionShape[]>();
  if (taskIds.length === 0) return map;

  const rows = await db
    .select()
    .from(workflowTaskCompletions)
    .where(
      and(
        eq(workflowTaskCompletions.entityType, entityType),
        eq(workflowTaskCompletions.entityId, entityId),
        inArray(workflowTaskCompletions.taskId, taskIds),
      ),
    );

  for (const row of rows) {
    const list = map.get(row.taskId);
    const shape = { taskId: row.taskId, confirmedByStaffUserId: row.confirmedByStaffUserId };
    if (list) list.push(shape);
    else map.set(row.taskId, [shape]);
  }
  return map;
}

/** Active tasks on one stage, in board order. */
async function loadStageTasks(stageId: string) {
  return db
    .select()
    .from(workflowStageTasks)
    .where(and(eq(workflowStageTasks.stageId, stageId), eq(workflowStageTasks.isActive, true)))
    .orderBy(asc(workflowStageTasks.sortOrder), asc(workflowStageTasks.slug));
}

/**
 * May ENTITY leave STAGE right now, given its blocking tasks?
 *
 * Takes an explicit `tx` because both callers — a task confirmation deciding
 * whether to auto-advance, and a board move checking before it writes — run
 * inside a transaction with the entity row already locked. Querying the
 * global `db` here instead would open a second connection while the first is
 * mid-transaction, which deadlocks PGlite's single connection.
 */
export async function evaluateStageExit(
  tx: Transaction,
  entityType: WorkflowBoardKey,
  entityId: string,
  stage: StageRow,
): Promise<StageExitCheck> {
  const stageTasks = (
    await tx
      .select()
      .from(workflowStageTasks)
      .where(and(eq(workflowStageTasks.stageId, stage.id), eq(workflowStageTasks.isActive, true)))
  ).map(toTaskShape);

  const completionRows = await tx
    .select({
      taskId: workflowTaskCompletions.taskId,
      confirmedByStaffUserId: workflowTaskCompletions.confirmedByStaffUserId,
    })
    .from(workflowTaskCompletions)
    .where(
      and(
        eq(workflowTaskCompletions.entityType, entityType),
        eq(workflowTaskCompletions.entityId, entityId),
      ),
    );

  const completions = new Map<string, CompletionShape[]>();
  for (const row of completionRows) {
    const list = completions.get(row.taskId);
    if (list) list.push(row);
    else completions.set(row.taskId, [row]);
  }

  const ownerIds = (await getStageOwnerIdsForMany([stage.id], tx)).get(stage.id) ?? [];
  const ownersByTask = new Map(stageTasks.map((t) => [t.id, ownerIds]));
  return canLeaveStage(stageTasks, stage.defaultConfirmationPolicy, completions, ownersByTask);
}

/** The checklist for whatever stage an entity is currently in. */
export async function getChecklist(
  entityType: WorkflowBoardKey,
  entityId: string,
): Promise<Checklist> {
  const entity = await loadEntity(entityType, entityId);
  const stages = await listActiveStages(entityType);
  const stage = resolveStage(stages, entity.status, entity.workflowStageSlug);

  if (!stage) {
    return {
      entityType,
      entityId,
      stageSlug: null,
      stageName: null,
      tasks: [],
      canLeaveStage: true,
      nextStageSlug: null,
    };
  }

  const taskRows = await loadStageTasks(stage.id);
  const shapes = taskRows.map(toTaskShape);
  const completions = await loadCompletions(
    entityType,
    entityId,
    shapes.map((t) => t.id),
  );
  const ownerIds = (await getStageOwnerIdsForMany([stage.id])).get(stage.id) ?? [];
  const ownersByTask = new Map(shapes.map((t) => [t.id, ownerIds]));

  const detail = await db
    .select()
    .from(workflowTaskCompletions)
    .where(
      and(
        eq(workflowTaskCompletions.entityType, entityType),
        eq(workflowTaskCompletions.entityId, entityId),
      ),
    );

  const exit = canLeaveStage(shapes, stage.defaultConfirmationPolicy, completions, ownersByTask);

  const tasks: ChecklistTask[] = shapes.map((shape) => {
    const policy = policyFor(shape, stage.defaultConfirmationPolicy);
    const mine = detail.filter((row) => row.taskId === shape.id);
    const confirmedIds = new Set(
      mine.map((row) => row.confirmedByStaffUserId).filter((id): id is string => id !== null),
    );
    const sidestepRow = mine.find((row) => row.sidestepped);
    const taskRow = taskRows.find((row) => row.id === shape.id);
    return {
      id: shape.id,
      slug: shape.slug,
      name: shape.name,
      description: taskRow?.description ?? null,
      isBlocking: shape.isBlocking,
      policy,
      gateKeys: shape.gateKeys,
      // The shared rule, not a second copy of it: a checklist that disagreed
      // with the gate about whether a task is done would be worse than either.
      satisfied: isTaskSatisfied(policy, completions.get(shape.id) ?? [], ownerIds),
      confirmations: mine.map((row) => ({
        staffUserId: row.confirmedByStaffUserId,
        email: row.confirmedByEmail,
        confirmedAt: row.confirmedAt.toISOString(),
        note: row.note,
      })),
      awaiting: policy === 'all' ? ownerIds.filter((id) => !confirmedIds.has(id)) : [],
      allowSidestep: taskRow?.allowSidestep ?? false,
      sidestepped: sidestepRow !== undefined,
      sidestepReason: sidestepRow?.sidestepReason ?? null,
    };
  });

  return {
    entityType,
    entityId,
    stageSlug: stage.slug,
    stageName: stage.name,
    tasks,
    canLeaveStage: exit.canLeave,
    nextStageSlug: nextStageInGroup(stages, stage)?.slug ?? null,
  };
}

export interface ConfirmResult {
  taskSlug: string;
  satisfied: boolean;
  /** Set when finishing this task moved the entity to the next stage. */
  advancedToStageSlug: string | null;
}

/**
 * Record one person's confirmation (or sidestep) of a task, and advance the
 * stage if that was the last blocking one.
 *
 * Everything happens under a row lock on the entity, so two people confirming
 * the final task at the same moment produce exactly one advance. The insert is
 * `onConflictDoNothing`, so a double-click is not an error.
 *
 * Advancing only ever moves WITHIN a status group. Crossing into another status
 * is a status transition with its own guards, and finishing a checklist should
 * never trigger one implicitly.
 */
async function recordCompletion(
  entityType: WorkflowBoardKey,
  entityId: string,
  taskId: string,
  meta: ActorMeta & { note?: string | null; sidestepped: boolean; sidestepReason?: string | null },
): Promise<ConfirmResult> {
  const stages = await listActiveStages(entityType);

  return db.transaction(async (tx) => {
    // Lock first: everything below reads state that the lock protects.
    const locked =
      entityType === 'order'
        ? (
            await tx
              .select({ status: orders.status, slug: orders.workflowStageSlug })
              .from(orders)
              .where(eq(orders.id, entityId))
              .for('update')
          )[0]
        : (
            await tx
              .select({
                status: purchaseOrders.status,
                slug: purchaseOrders.workflowStageSlug,
              })
              .from(purchaseOrders)
              .where(eq(purchaseOrders.id, entityId))
              .for('update')
          )[0];
    if (!locked) throw new NotFoundError(entityType === 'order' ? 'Order' : 'Purchase order');

    const stage = resolveStage(stages, locked.status, locked.slug);
    if (!stage) throw new ConflictError('This item is not in a workflow stage');

    const [task] = await tx
      .select()
      .from(workflowStageTasks)
      .where(and(eq(workflowStageTasks.id, taskId), eq(workflowStageTasks.isActive, true)));
    if (!task) throw new NotFoundError('Task');

    if (meta.sidestepped && !task.allowSidestep) {
      throw new ConflictError(`"${task.name}" cannot be sidestepped — it has to be done`);
    }

    // Already recorded by this person? Then this is a double-click or a retry,
    // and the answer is "yes, still done" — not an error. Checked BEFORE the
    // stage guard, because confirming the last task advances the job, so the
    // second click would otherwise be told the task belongs to another stage,
    // which is both alarming and useless.
    const [already] = await tx
      .select({ id: workflowTaskCompletions.id })
      .from(workflowTaskCompletions)
      .where(
        and(
          eq(workflowTaskCompletions.taskId, taskId),
          eq(workflowTaskCompletions.entityType, entityType),
          eq(workflowTaskCompletions.entityId, entityId),
          meta.actorStaffUserId
            ? eq(workflowTaskCompletions.confirmedByStaffUserId, meta.actorStaffUserId)
            : isNull(workflowTaskCompletions.confirmedByStaffUserId),
        ),
      );
    if (already) {
      return { taskSlug: task.slug, satisfied: true, advancedToStageSlug: null };
    }

    // A NEW confirmation only makes sense for the stage the job is actually in.
    // Otherwise a stale tab could tick a check the job has already moved past.
    if (task.stageId !== stage.id) {
      throw new ConflictError('That task belongs to a different stage');
    }

    await tx
      .insert(workflowTaskCompletions)
      .values({
        taskId,
        entityType,
        entityId,
        confirmedByStaffUserId: meta.actorStaffUserId ?? null,
        confirmedByEmail: meta.actorEmail ?? null,
        note: meta.note ?? null,
        sidestepped: meta.sidestepped,
        sidestepReason: meta.sidestepped ? (meta.sidestepReason ?? null) : null,
      })
      // Idempotent: confirming twice is a double-click, not an error.
      .onConflictDoNothing();

    await recordAuditEvent(
      {
        aggregateId: entityId,
        aggregateType: entityType === 'order' ? 'order' : 'purchase_order',
        eventType: meta.sidestepped ? 'workflow.task_sidestepped' : 'workflow.task_confirmed',
        payload: {
          taskId,
          taskSlug: task.slug,
          stageSlug: stage.slug,
          ...(meta.sidestepped && { reason: meta.sidestepReason }),
        },
        actorEmail: meta.actorEmail ?? null,
      },
      tx,
    );

    // Re-evaluate inside the lock, against what is now committed in this tx.
    const exit = await evaluateStageExit(tx, entityType, entityId, stage);

    let advancedTo: StageRow | null = null;
    if (exit.canLeave) {
      const next = nextStageInGroup(stages, stage);
      if (next) {
        advancedTo = stages.find((s) => s.slug === next.slug) ?? null;
        const now = new Date();
        if (entityType === 'order') {
          await tx
            .update(orders)
            .set({ workflowStageSlug: next.slug, stageEnteredAt: now, updatedAt: now })
            .where(eq(orders.id, entityId));
        } else {
          await tx
            .update(purchaseOrders)
            .set({ workflowStageSlug: next.slug, stageEnteredAt: now, updatedAt: now })
            .where(eq(purchaseOrders.id, entityId));
        }

        // Outbox (see moves.ts) so the stage-owner notification fires for a
        // stage reached by finishing a checklist, not just by dragging a card.
        await emitOrderEvent(tx, {
          aggregateId: entityId,
          eventType: 'workflow.stage_entered',
          payload: {
            stageSlug: next.slug,
            boardKey: entityType,
            via: 'task_completion',
            actorEmail: meta.actorEmail ?? null,
          },
        });
      }
    }

    return {
      taskSlug: task.slug,
      satisfied: !exit.outstanding.some((t) => t.id === taskId),
      advancedToStageSlug: advancedTo?.slug ?? null,
    };
  });
}

/** Record one person's confirmation of a task. See `recordCompletion`. */
export async function confirmTask(
  entityType: WorkflowBoardKey,
  entityId: string,
  taskId: string,
  meta: ActorMeta & { note?: string | null },
): Promise<ConfirmResult> {
  return recordCompletion(entityType, entityId, taskId, { ...meta, sidestepped: false });
}

/**
 * Acknowledge a task as sidestepped rather than done — only legal on tasks
 * configured `allowSidestep`, and only with a stated reason. Both refusals are
 * hard: an unreasoned acknowledgement, or one on a must-do task, is exactly the
 * silent skip the checklist exists to prevent (same reasoning as the PO
 * pre-send checklist's sidestep, `checklist-service.ts`).
 */
export async function sidestepTask(
  entityType: WorkflowBoardKey,
  entityId: string,
  taskId: string,
  meta: ActorMeta & { reason: string },
): Promise<ConfirmResult> {
  const reason = meta.reason.trim();
  if (!reason) throw new ConflictError('Give a reason for sidestepping this check');
  return recordCompletion(entityType, entityId, taskId, {
    actorEmail: meta.actorEmail,
    actorStaffUserId: meta.actorStaffUserId,
    sidestepped: true,
    sidestepReason: reason,
  });
}

/**
 * Undo a confirmation. Admin-only, because the interesting case is correcting
 * someone else's mistake — and unlike confirming, it can move work backwards in
 * everyone else's view.
 *
 * Deliberately does NOT move the stage back: the job may legitimately have moved
 * on, and silently dragging it backwards would be more surprising than leaving
 * the checklist showing what is now outstanding.
 */
export async function reopenTask(
  entityType: WorkflowBoardKey,
  entityId: string,
  taskId: string,
  meta: ActorMeta,
): Promise<void> {
  if (!meta.isAdmin) throw new ConflictError('Only an admin can reopen a task');

  await db.transaction(async (tx) => {
    const deleted = await tx
      .delete(workflowTaskCompletions)
      .where(
        and(
          eq(workflowTaskCompletions.taskId, taskId),
          eq(workflowTaskCompletions.entityType, entityType),
          eq(workflowTaskCompletions.entityId, entityId),
        ),
      )
      .returning({ id: workflowTaskCompletions.id });

    if (deleted.length === 0) return;

    await recordAuditEvent(
      {
        aggregateId: entityId,
        aggregateType: entityType === 'order' ? 'order' : 'purchase_order',
        eventType: 'workflow.task_reopened',
        payload: { taskId, clearedConfirmations: deleted.length },
        actorEmail: meta.actorEmail ?? null,
      },
      tx,
    );
  });
}
