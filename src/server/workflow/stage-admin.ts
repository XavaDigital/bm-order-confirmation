/**
 * Stage configuration — the writes behind the workflow settings page.
 *
 * Reads and the pure resolution rules live in `stages.ts`; this file is the
 * management surface: create a step, rename it, recolour it, retune its clocks,
 * reorder it, retire it.
 *
 * What this deliberately does NOT do is let anyone add a STATUS. Statuses are
 * the state machine every consumer depends on — the outbox, the Google Ads
 * conversion, the customer surface — so a stage always declares which existing
 * status it sits under. That layering is what lets staff add "Digitising"
 * without teaching every consumer a new word.
 */
import { and, eq, max } from 'drizzle-orm';
import { db } from '@/db';
import { workflowStages } from '@/db/schema';
import type { ConfirmationPolicy, WorkflowBoardKey } from '@/db/schema';
import { recordAuditEvent } from '@/server/events/outbox';
import { isProtectedStage, listAllStages, type StageRow } from './stages';
import { ORDER_STATUS, PO_STATUS } from '@/lib/status';

/** Thrown when a change would leave the board unable to place existing cards. */
export class WorkflowStageConflictError extends Error {
  name = 'WorkflowStageConflictError';
  constructor(message: string) {
    super(message);
  }
}

export class WorkflowStageNotFoundError extends Error {
  name = 'WorkflowStageNotFoundError';
  constructor() {
    super('Stage not found');
  }
}

/** The statuses a stage may sit under, per board. */
export function statusKeysFor(boardKey: WorkflowBoardKey): string[] {
  return Object.keys(boardKey === 'order' ? ORDER_STATUS : PO_STATUS);
}

/**
 * Slugs are what order and PO rows carry, so they are generated once at
 * creation and never derived from the name again — renaming "Artwork" to
 * "Artwork & Layout" must not strand every card sitting in it.
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

async function uniqueSlug(boardKey: WorkflowBoardKey, name: string): Promise<string> {
  const base = slugify(name) || 'stage';
  const existing = new Set((await listAllStages(boardKey)).map((s) => s.slug));
  if (!existing.has(base)) return base;
  for (let n = 2; n < 200; n += 1) {
    const candidate = `${base}_${n}`;
    if (!existing.has(candidate)) return candidate;
  }
  throw new WorkflowStageConflictError('Could not generate a unique slug for that name.');
}

export interface CreateStageInput {
  boardKey: WorkflowBoardKey;
  name: string;
  statusKey: string;
  color?: string | null;
  warnAfterHours?: number | null;
  urgentAfterHours?: number | null;
  defaultConfirmationPolicy?: ConfirmationPolicy;
}

export async function createStage(
  input: CreateStageInput,
  meta?: { actorEmail?: string },
): Promise<StageRow> {
  if (!statusKeysFor(input.boardKey).includes(input.statusKey)) {
    throw new WorkflowStageConflictError(
      `"${input.statusKey}" is not a status on the ${input.boardKey} board.`,
    );
  }

  const slug = await uniqueSlug(input.boardKey, input.name);

  // Append to the end of its status group rather than the board, so a new step
  // lands where it was asked for instead of at the far right of everything.
  const [{ value: highest } = { value: null }] = await db
    .select({ value: max(workflowStages.sortOrder) })
    .from(workflowStages)
    .where(
      and(
        eq(workflowStages.boardKey, input.boardKey),
        eq(workflowStages.statusKey, input.statusKey),
      ),
    );

  const [row] = await db
    .insert(workflowStages)
    .values({
      boardKey: input.boardKey,
      slug,
      name: input.name,
      statusKey: input.statusKey,
      sortOrder: (highest ?? 0) + 1,
      color: input.color ?? null,
      warnAfterHours: input.warnAfterHours ?? null,
      urgentAfterHours: input.urgentAfterHours ?? null,
      defaultConfirmationPolicy: input.defaultConfirmationPolicy ?? 'any',
    })
    .returning();

  await recordAuditEvent({
    aggregateType: 'workflow_stage',
    aggregateId: row.id,
    eventType: 'workflow.stage_created',
    actorEmail: meta?.actorEmail ?? null,
    payload: { boardKey: row.boardKey, slug: row.slug, name: row.name, statusKey: row.statusKey },
  });

  return row;
}

export interface UpdateStageInput {
  name?: string;
  color?: string | null;
  warnAfterHours?: number | null;
  urgentAfterHours?: number | null;
  defaultConfirmationPolicy?: ConfirmationPolicy;
  isActive?: boolean;
  isTerminal?: boolean;
}

export async function updateStage(
  stageId: string,
  patch: UpdateStageInput,
  meta?: { actorEmail?: string },
): Promise<StageRow> {
  const [current] = await db.select().from(workflowStages).where(eq(workflowStages.id, stageId));
  if (!current) throw new WorkflowStageNotFoundError();

  /**
   * A protected stage is the fallback its whole status group resolves to. Retire
   * it and every card in that status has nowhere to render — `defaultStageFor`
   * returns null and the cards fall off the board. Renaming and recolouring are
   * fine; the slug is what the fallback keys on, and that never changes here.
   */
  if (patch.isActive === false && isProtectedStage(current.boardKey, current.slug)) {
    throw new WorkflowStageConflictError(
      `"${current.name}" is the fallback stage for the ${current.statusKey} status and cannot be deactivated. Rename it instead.`,
    );
  }

  const [row] = await db
    .update(workflowStages)
    .set({
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.color !== undefined && { color: patch.color }),
      ...(patch.warnAfterHours !== undefined && { warnAfterHours: patch.warnAfterHours }),
      ...(patch.urgentAfterHours !== undefined && { urgentAfterHours: patch.urgentAfterHours }),
      ...(patch.defaultConfirmationPolicy !== undefined && {
        defaultConfirmationPolicy: patch.defaultConfirmationPolicy,
      }),
      ...(patch.isActive !== undefined && { isActive: patch.isActive }),
      ...(patch.isTerminal !== undefined && { isTerminal: patch.isTerminal }),
      updatedAt: new Date(),
    })
    .where(eq(workflowStages.id, stageId))
    .returning();

  await recordAuditEvent({
    aggregateType: 'workflow_stage',
    aggregateId: row.id,
    eventType: 'workflow.stage_updated',
    actorEmail: meta?.actorEmail ?? null,
    payload: { slug: row.slug, changes: patch },
  });

  return row;
}

/**
 * Reorder stages within one board.
 *
 * Takes the full ordered id list rather than a from/to pair: the settings page
 * knows the order it is showing, and applying it wholesale avoids the drift you
 * get when two people renumber at once.
 */
export async function reorderStages(
  boardKey: WorkflowBoardKey,
  orderedStageIds: string[],
  meta?: { actorEmail?: string },
): Promise<StageRow[]> {
  const stages = await listAllStages(boardKey);
  const known = new Set(stages.map((s) => s.id));
  const unknown = orderedStageIds.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new WorkflowStageConflictError('That ordering refers to stages from another board.');
  }

  await db.transaction(async (tx) => {
    for (const [index, id] of orderedStageIds.entries()) {
      await tx
        .update(workflowStages)
        .set({ sortOrder: index + 1, updatedAt: new Date() })
        .where(eq(workflowStages.id, id));
    }
  });

  await recordAuditEvent({
    aggregateType: 'workflow_stage',
    aggregateId: orderedStageIds[0] ?? boardKey,
    eventType: 'workflow.stages_reordered',
    actorEmail: meta?.actorEmail ?? null,
    payload: { boardKey, orderedStageIds },
  });

  return listAllStages(boardKey);
}
