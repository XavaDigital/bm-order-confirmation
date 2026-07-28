/**
 * Gates: checks that must pass before a consequential action is allowed.
 *
 * A gate is deliberately NOT a table. It is a question asked of the checklist —
 * "is every active task carrying this key satisfied?" — so an admin puts a task
 * behind a gate by ticking a key on it, with no schema change and no second
 * place for the two to disagree.
 *
 * The catalog below is code because each entry has a hard-wired call site: a key
 * nobody checks is worse than no key at all, since it looks like protection.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { workflowStageTasks, workflowTaskCompletions } from '@/db/schema';
import type { WorkflowBoardKey } from '@/db/schema';
import { recordAuditEvent } from '@/server/events/outbox';
import { ConflictError } from '@/server/orders/service';
import { listActiveStages } from './stages';
import { getStageOwnerIdsForMany } from './assignments';
import { evaluateGateRules, policyFor, type CompletionShape, type TaskShape } from './task-rules';

export interface GateDefinition {
  key: string;
  label: string;
  /** Which board's checklist the gate reads. */
  boardKey: WorkflowBoardKey;
  description: string;
}

/**
 * Every gate the code actually enforces.
 *
 * All three read the ORDER's checklist, including the two about purchase orders:
 * pre-production steps live on the job, not on the paperwork sent to a supplier,
 * so a second PO for the same order is held by the same checks as the first.
 */
export const GATE_CATALOG: readonly GateDefinition[] = [
  {
    key: 'po_send',
    label: 'Before a purchase order is sent',
    boardKey: 'order',
    description:
      'Checked when a PO is emailed to a supplier. Artwork, sizing and fabric checks belong here.',
  },
  {
    key: 'po_production_start',
    label: 'Before production starts',
    boardKey: 'order',
    description: 'Checked when a purchase order moves into production.',
  },
  {
    key: 'order_confirm',
    label: 'Before a confirmation link is sent',
    boardKey: 'order',
    description: 'Checked when a confirmation link goes to the customer.',
  },
] as const;

export type GateKey = (typeof GATE_CATALOG)[number]['key'];

export function isKnownGate(key: string): boolean {
  return GATE_CATALOG.some((gate) => gate.key === key);
}

/**
 * A blocked action. Carries the outstanding task names on `details` so the UI can
 * list them — `defineRoute` maps `*ConflictError` to 409 and passes `details`
 * through.
 */
export class WorkflowGateConflictError extends ConflictError {
  readonly details: { gateKey: string; outstanding: Array<{ slug: string; name: string }> };

  constructor(gateKey: string, outstanding: Array<{ slug: string; name: string }>) {
    const names = outstanding.map((task) => task.name).join(', ');
    super(`Blocked by outstanding checks: ${names}`);
    // Extends the app's ConflictError, not plain Error: routes that rethrow
    // `instanceof ConflictError` (the PO send route does) would otherwise
    // swallow this into a 500 and lose both the status and the details list.
    this.name = 'WorkflowGateConflictError';
    this.details = { gateKey, outstanding };
  }
}

export interface GateResult {
  gateKey: string;
  open: boolean;
  outstanding: Array<{ id: string; slug: string; name: string; isBlocking: boolean }>;
}

/**
 * Evaluate a gate against an entity's checklist across ALL its stages, not just
 * the one it is sitting in.
 *
 * Deliberate: a check from an earlier stage that was skipped or reopened must
 * still hold the gate. Scoping to the current stage would mean a job could be
 * dragged past a stage to escape its checks.
 */
export async function evaluateGate(
  gateKey: string,
  entityType: WorkflowBoardKey,
  entityId: string,
): Promise<GateResult> {
  const stages = await listActiveStages(entityType);
  if (stages.length === 0) return { gateKey, open: true, outstanding: [] };

  const stageIds = stages.map((stage) => stage.id);
  const taskRows = await db
    .select()
    .from(workflowStageTasks)
    .where(
      and(inArray(workflowStageTasks.stageId, stageIds), eq(workflowStageTasks.isActive, true)),
    );

  const shapes: TaskShape[] = taskRows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    isBlocking: row.isBlocking,
    confirmationPolicy: row.confirmationPolicy,
    gateKeys: row.gateKeys,
  }));

  const completionRows = await db
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

  const ownersByStage = await getStageOwnerIdsForMany(stageIds);
  const stageById = new Map(stages.map((stage) => [stage.id, stage]));
  const taskStage = new Map(taskRows.map((row) => [row.id, row.stageId]));
  const ownersByTask = new Map(
    shapes.map((task) => [task.id, ownersByStage.get(taskStage.get(task.id) ?? '') ?? []]),
  );

  const { open, outstanding } = evaluateGateRules(
    shapes,
    gateKey,
    (task) => {
      const stage = stageById.get(taskStage.get(task.id) ?? '');
      return policyFor(task, stage?.defaultConfirmationPolicy ?? 'any');
    },
    completions,
    ownersByTask,
  );

  return {
    gateKey,
    open,
    outstanding: outstanding.map((task) => ({
      id: task.id,
      slug: task.slug,
      name: task.name,
      isBlocking: task.isBlocking,
    })),
  };
}

/**
 * Throw unless the gate is open.
 *
 * `override` skips the check and records WHY, audited against the order. A gate
 * with no escape hatch gets defeated by people ticking checks they did not do,
 * which is strictly worse than no gate: the control is gone AND the data is now
 * a lie. An override at least leaves an honest, attributable trail.
 */
export async function assertGateOpen(
  gateKey: string,
  entityType: WorkflowBoardKey,
  entityId: string,
  options?: {
    override?: { reason: string; actorEmail?: string | null };
    /** Recorded on the audit row so the trail says what was let through. */
    context?: Record<string, unknown>;
  },
): Promise<void> {
  const result = await evaluateGate(gateKey, entityType, entityId);
  if (result.open) return;

  if (options?.override) {
    const reason = options.override.reason.trim();
    // An override with no reason is indistinguishable from no gate.
    if (!reason) throw new WorkflowGateConflictError(gateKey, result.outstanding);

    await recordAuditEvent({
      aggregateId: entityId,
      aggregateType: entityType === 'order' ? 'order' : 'purchase_order',
      eventType: 'workflow.gate_overridden',
      payload: {
        gateKey,
        reason,
        outstanding: result.outstanding.map((task) => task.slug),
        ...options.context,
      },
      actorEmail: options.override.actorEmail ?? null,
    });
    return;
  }

  throw new WorkflowGateConflictError(gateKey, result.outstanding);
}
