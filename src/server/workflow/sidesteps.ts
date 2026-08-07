/**
 * "Was any check on this job skipped rather than done?" (David, 2026-08-07)
 *
 * A sidestep is a deliberate, reasoned acknowledgement that a check will not be
 * performed — but the person who made that call is not necessarily the person
 * who should decide it was safe. So the fact has to be able to travel: a
 * purchase order entering production carries it, and an automation rule can
 * pick it up and tell someone to go and look.
 *
 * Three places record one, and all three count. Splitting them would mean a
 * check skipped on the pre-send checklist raised a flag while the same decision
 * taken on the board did not:
 *  - stage checks on the ORDER board (where the pre-production steps live —
 *    artwork, digitising, fabric, sizing, colour sample);
 *  - stage checks on the PURCHASE ORDER board;
 *  - the purchase order's own pre-send checklist.
 *
 * Only ACTIVE checks count. A sidestep against a check since deactivated is a
 * decision about a question no longer being asked, and re-raising it would make
 * retiring a check impossible without leaving old jobs flagged forever.
 */
import { and, eq, or } from 'drizzle-orm';
import type { db, Transaction } from '@/db';
import {
  poChecklistCompletions,
  poChecklistItems,
  workflowStageTasks,
  workflowTaskCompletions,
} from '@/db/schema';

export interface SidesteppedChecks {
  /** Distinct checks skipped — not rows, since an `all` task has one per person. */
  count: number;
  /** Their names, for the notification body: "go and look" needs to say at what. */
  labels: string[];
}

type Executor = Transaction | typeof db;

/**
 * Every still-standing sidestep on a job, across both boards and the purchase
 * order's pre-send checklist.
 *
 * Takes an explicit executor because the caller is `updatePurchaseOrderStatusTx`,
 * mid-transaction with the purchase order row locked — querying the global `db`
 * from inside a transaction deadlocks PGlite's single connection.
 */
export async function listSidesteppedChecks(
  executor: Executor,
  orderId: string,
  poId: string,
): Promise<SidesteppedChecks> {
  // The completions table is polymorphic on (entityType, entityId) with no FK,
  // so the job's rows are matched as pairs — the order's, and this purchase
  // order's — rather than filtered after the fact.
  const stageRows = await executor
    .select({ name: workflowStageTasks.name })
    .from(workflowTaskCompletions)
    .innerJoin(workflowStageTasks, eq(workflowStageTasks.id, workflowTaskCompletions.taskId))
    .where(
      and(
        eq(workflowTaskCompletions.sidestepped, true),
        eq(workflowStageTasks.isActive, true),
        or(
          and(
            eq(workflowTaskCompletions.entityType, 'order'),
            eq(workflowTaskCompletions.entityId, orderId),
          ),
          and(
            eq(workflowTaskCompletions.entityType, 'purchase_order'),
            eq(workflowTaskCompletions.entityId, poId),
          ),
        ),
      ),
    );

  const checklistRows = await executor
    .select({ label: poChecklistItems.label })
    .from(poChecklistCompletions)
    .innerJoin(poChecklistItems, eq(poChecklistItems.id, poChecklistCompletions.itemId))
    .where(
      and(
        eq(poChecklistCompletions.poId, poId),
        eq(poChecklistCompletions.sidestepped, true),
        eq(poChecklistItems.isActive, true),
      ),
    );

  // Deduped by name: an `all`-policy task records one row per person, and the
  // question being answered is "which checks", not "how many acknowledgements".
  const labels = new Set<string>();
  for (const row of stageRows) labels.add(row.name);
  for (const row of checklistRows) labels.add(row.label);

  return { count: labels.size, labels: [...labels] };
}
