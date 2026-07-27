/**
 * Stage reads and the pure resolution rules the boards are built from.
 *
 * A stage is a configurable column that sits UNDER one of the fixed enum
 * statuses. That layering is the whole design: staff can add pre-production
 * steps without inventing statuses that every outbox consumer would then have to
 * learn, and the status enums remain the state machine.
 *
 * Everything in the top half of this file is pure, so the resolution rules —
 * which is where the subtle bugs live — are unit-testable without a database.
 */
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { workflowStages, workflowStageTasks } from '@/db/schema';
import type { ConfirmationPolicy, WorkflowBoardKey } from '@/db/schema';

export type StageRow = typeof workflowStages.$inferSelect;
export type StageTaskRow = typeof workflowStageTasks.$inferSelect;

/**
 * The one-stage-per-status set seeded in migration 0020.
 *
 * These may be renamed, recoloured and reordered, but never deactivated: the
 * default-stage fallback needs at least one active stage per status, and without
 * one an existing row would have nowhere to render on the board.
 */
export const PROTECTED_STAGE_SLUGS: Readonly<Record<WorkflowBoardKey, readonly string[]>> = {
  order: ['draft', 'sent', 'viewed', 'changes_requested', 'confirmed', 'cancelled'],
  purchase_order: [
    'draft',
    'sent',
    'confirmed',
    'pre_production',
    'in_production',
    'in_transit',
    'received',
    'completed',
    'remake',
    'cancelled',
  ],
};

export function isProtectedStage(boardKey: WorkflowBoardKey, slug: string): boolean {
  return PROTECTED_STAGE_SLUGS[boardKey].includes(slug);
}

/** Active stages for one status, in board order. */
export function stagesForStatus(stages: StageRow[], statusKey: string): StageRow[] {
  return stages
    .filter((stage) => stage.isActive && stage.statusKey === statusKey)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.slug.localeCompare(b.slug));
}

/**
 * The stage a row lands in when it has no stage recorded, or names one that has
 * since been deactivated or deleted.
 *
 * Defined as "first active stage in the status group" rather than by a naming
 * convention or an `isDefault` column: it cannot break when a stage is renamed,
 * and it stays correct if someone inserts a new first step. Returns null only if
 * a status has no active stage at all, which `PROTECTED_STAGE_SLUGS` exists to
 * prevent.
 */
export function defaultStageFor(stages: StageRow[], statusKey: string): StageRow | null {
  return stagesForStatus(stages, statusKey)[0] ?? null;
}

/**
 * Where a row actually sits: its recorded stage if that is still valid FOR ITS
 * CURRENT STATUS, else the status group's default.
 *
 * The status check matters — a row whose status moved on (a customer confirmed
 * it, say) still carries the slug of the stage it sat in beforehand, and showing
 * it in a column belonging to another status would put the board and the status
 * visibly out of step.
 */
export function resolveStage(
  stages: StageRow[],
  statusKey: string,
  recordedSlug: string | null,
): StageRow | null {
  if (recordedSlug) {
    const match = stages.find(
      (stage) =>
        stage.slug === recordedSlug && stage.statusKey === statusKey && stage.isActive,
    );
    if (match) return match;
  }
  return defaultStageFor(stages, statusKey);
}

/** The confirmation policy in force for a task — its own, else its stage's. */
export function effectivePolicy(task: StageTaskRow, stage: StageRow): ConfirmationPolicy {
  return task.confirmationPolicy ?? stage.defaultConfirmationPolicy;
}

/**
 * Is this a move within one status group (a pure stage move), or does it cross
 * into another status (which must also perform a status transition)?
 */
export function isSameStatusMove(from: StageRow, to: StageRow): boolean {
  return from.statusKey === to.statusKey;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Every stage on a board, including inactive ones (the config screen needs them). */
export async function listAllStages(boardKey: WorkflowBoardKey): Promise<StageRow[]> {
  return db.query.workflowStages.findMany({
    where: eq(workflowStages.boardKey, boardKey),
    orderBy: [asc(workflowStages.sortOrder), asc(workflowStages.slug)],
  });
}

/** Active stages only — what a board renders as its columns. */
export async function listActiveStages(boardKey: WorkflowBoardKey): Promise<StageRow[]> {
  return db.query.workflowStages.findMany({
    where: and(eq(workflowStages.boardKey, boardKey), eq(workflowStages.isActive, true)),
    orderBy: [asc(workflowStages.sortOrder), asc(workflowStages.slug)],
  });
}

export async function findStageBySlug(
  boardKey: WorkflowBoardKey,
  slug: string,
): Promise<StageRow | null> {
  const stage = await db.query.workflowStages.findFirst({
    where: and(eq(workflowStages.boardKey, boardKey), eq(workflowStages.slug, slug)),
  });
  return stage ?? null;
}

/** Active tasks for a set of stages, keyed by stage id — one query, no N+1. */
export async function listTasksForStages(
  stageIds: string[],
): Promise<Record<string, StageTaskRow[]>> {
  if (stageIds.length === 0) return {};

  const rows = await db.query.workflowStageTasks.findMany({
    where: (task, { inArray, eq: isEq, and: both }) =>
      both(inArray(task.stageId, stageIds), isEq(task.isActive, true)),
    orderBy: [asc(workflowStageTasks.sortOrder), asc(workflowStageTasks.slug)],
  });

  const byStage: Record<string, StageTaskRow[]> = {};
  for (const row of rows) {
    (byStage[row.stageId] ??= []).push(row);
  }
  return byStage;
}
