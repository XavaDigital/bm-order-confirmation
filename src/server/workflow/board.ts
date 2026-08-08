/**
 * Board reads: the columns and the cards that sit in them.
 *
 * Cards are grouped in code rather than by a `GROUP BY` per column, so the whole
 * board is two queries (stages, then entities) instead of one per column. It also
 * means the null/unknown-slug fallback in `resolveStage` is applied consistently
 * — a row can only be in one column, and it is always the one its status allows.
 */
import { and, desc, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import { db } from '@/db';
import { orders, purchaseOrders, workflowTaskCompletions } from '@/db/schema';
import type { WorkflowBoardKey } from '@/db/schema';
import { poDisplayTitle } from '@/lib/po-title';
import { orderFeaturedImages, poFeaturedImages } from './featured-images';
import { listActiveStages, listTasksForStages, resolveStage, type StageRow } from './stages';

/** How overdue a card is against its stage's thresholds. */
export type StageUrgency = 'ok' | 'warn' | 'urgent';

export interface BoardCard {
  id: string;
  /** Order number, or PO number on the PO board. */
  reference: string;
  title: string;
  subtitle: string | null;
  status: string;
  stageSlug: string;
  /** Null when the row has never been staged — the card shows no clock. */
  stageEnteredAt: string | null;
  hoursInStage: number | null;
  urgency: StageUrgency;
  /** Blocking tasks on this card's stage that nobody has confirmed yet. */
  outstandingTaskSlugs: string[];
  value: { amount: string; currency: string } | null;
  deadlineDate: string | null;
  /**
   * Signed thumbnail of the first garment's first image (David, 2026-08-09) —
   * for recognising a job at a glance. Absent when there is no image, or when
   * signing it failed; a card without a picture is fine.
   */
  featuredImageUrl?: string | null;
  supplierName?: string | null;
  orderId?: string;
  /**
   * PO cards only: the factory has submitted a finished phase and it is waiting
   * on US (David, 2026-08-06). A boolean rather than the timestamp because the
   * card only needs to badge — the who/when/note live on the PO page, which is
   * one click away. Absent on order cards.
   */
  awaitingApproval?: boolean;
}

export interface BoardColumn {
  slug: string;
  name: string;
  statusKey: string;
  color: string | null;
  isTerminal: boolean;
  cards: BoardCard[];
}

export interface Board {
  boardKey: WorkflowBoardKey;
  columns: BoardColumn[];
  /** Cards whose status has no active stage at all — should always be empty. */
  orphanedCount: number;
}

/**
 * Fallback warn/urgent thresholds, in hours, for a stage that sets neither.
 *
 * Deliberately generous: this only applies to stages nobody has tuned, and a
 * board that cries wolf on every card gets its colours ignored. The stages that
 * matter carry their own values from the 0020 seeds — `sent` at 72h mirrors
 * `STALE_THRESHOLD_DAYS.sent`, `viewed` at 120h mirrors its 5 days — so the
 * board and the separate "Needs Follow-up" widget agree where they overlap.
 */
const DEFAULT_WARN_HOURS = 7 * 24;
const DEFAULT_URGENT_HOURS = 14 * 24;

export function hoursBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 3_600_000;
}

/**
 * The stage clock, but only when it actually refers to the stage the card is
 * shown in.
 *
 * A status can change without going through the board — a customer confirms
 * their order, a PO is sent — and those paths keep their own guards and are
 * deliberately not rewritten to stamp the stage (see `syncStageToStatusTx` for
 * the ones that are). The row then carries a slug belonging to its PREVIOUS
 * status, `resolveStage` re-homes the card, and the stored timestamp is about a
 * stage the card is no longer in.
 *
 * Reporting it anyway would inflate the age and make freshly-advanced work look
 * stuck, which is the failure that makes people stop trusting the colours. Unknown
 * is reported as unknown: no age badge, and excluded from the stuck scan.
 */
export function clockForStage(
  resolvedSlug: string,
  recordedSlug: string | null,
  stageEnteredAt: Date | null,
): Date | null {
  return recordedSlug === resolvedSlug ? stageEnteredAt : null;
}

/**
 * Urgency for a card. A terminal stage is never urgent — nothing is expected to
 * leave "Completed", so flagging it would train people to ignore the colour.
 */
export function stageUrgency(
  stage: StageRow,
  stageEnteredAt: Date | null,
  now: Date,
): { urgency: StageUrgency; hoursInStage: number | null } {
  if (!stageEnteredAt || stage.isTerminal) {
    return { urgency: 'ok', hoursInStage: stageEnteredAt ? hoursBetween(stageEnteredAt, now) : null };
  }

  const hours = hoursBetween(stageEnteredAt, now);
  const warn = stage.warnAfterHours ?? DEFAULT_WARN_HOURS;
  const urgent = stage.urgentAfterHours ?? DEFAULT_URGENT_HOURS;

  if (hours >= urgent) return { urgency: 'urgent', hoursInStage: hours };
  if (hours >= warn) return { urgency: 'warn', hoursInStage: hours };
  return { urgency: 'ok', hoursInStage: hours };
}

/**
 * Group already-loaded rows into columns.
 *
 * Pure, so the grouping and fallback rules are testable without a database —
 * which matters because "which column does this card belong in" is where a wrong
 * answer is most visible to users.
 */
export function buildColumns<T extends { status: string; workflowStageSlug: string | null }>(
  stages: StageRow[],
  rows: T[],
  toCard: (row: T, stage: StageRow) => BoardCard,
): { columns: BoardColumn[]; orphanedCount: number } {
  const columns = new Map<string, BoardColumn>();
  for (const stage of stages) {
    columns.set(stage.slug, {
      slug: stage.slug,
      name: stage.name,
      statusKey: stage.statusKey,
      color: stage.color,
      isTerminal: stage.isTerminal,
      cards: [],
    });
  }

  let orphanedCount = 0;
  for (const row of rows) {
    const stage = resolveStage(stages, row.status, row.workflowStageSlug);
    if (!stage) {
      // No active stage for this status: the row has nowhere legitimate to go, so
      // it is counted rather than dropped into an arbitrary column.
      orphanedCount += 1;
      continue;
    }
    columns.get(stage.slug)?.cards.push(toCard(row, stage));
  }

  return { columns: [...columns.values()], orphanedCount };
}

/**
 * Which blocking tasks are still outstanding, per entity.
 *
 * One query for every entity on the board rather than one per card. Only
 * BLOCKING tasks count towards the card badge: a non-blocking task is meant to
 * follow the job without nagging, and surfacing it here would make the badge
 * mean "something is pending" instead of "this cannot move on".
 */
async function loadOutstandingTasks(
  entityType: WorkflowBoardKey,
  entityIds: string[],
  stages: StageRow[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (entityIds.length === 0) return result;

  const tasksByStage = await listTasksForStages(stages.map((stage) => stage.id));
  const blockingIds = Object.values(tasksByStage)
    .flat()
    .filter((task) => task.isBlocking)
    .map((task) => task.id);
  if (blockingIds.length === 0) return result;

  const completions = await db
    .select({
      taskId: workflowTaskCompletions.taskId,
      entityId: workflowTaskCompletions.entityId,
    })
    .from(workflowTaskCompletions)
    .where(
      and(
        eq(workflowTaskCompletions.entityType, entityType),
        inArray(workflowTaskCompletions.entityId, entityIds),
        inArray(workflowTaskCompletions.taskId, blockingIds),
      ),
    );

  const done = new Set(completions.map((row) => `${row.entityId}:${row.taskId}`));
  for (const entityId of entityIds) {
    const outstanding: string[] = [];
    for (const stage of stages) {
      for (const task of tasksByStage[stage.id] ?? []) {
        if (!task.isBlocking) continue;
        if (!done.has(`${entityId}:${task.id}`)) outstanding.push(task.slug);
      }
    }
    result.set(entityId, outstanding);
  }
  return result;
}

/** The order board. Cancelled orders are excluded unless asked for. */
export async function getOrderBoard(opts?: { includeCancelled?: boolean }): Promise<Board> {
  const stages = await listActiveStages('order');

  const rows = await db.query.orders.findMany({
    where: opts?.includeCancelled ? undefined : ne(orders.status, 'cancelled'),
    columns: {
      id: true,
      orderNumber: true,
      customerName: true,
      clubName: true,
      status: true,
      workflowStageSlug: true,
      stageEnteredAt: true,
      orderValueAmount: true,
      orderValueCurrency: true,
      deadlineDate: true,
      createdAt: true,
    },
    orderBy: [desc(orders.createdAt)],
  });

  const [outstanding, featured] = await Promise.all([
    loadOutstandingTasks(
      'order',
      rows.map((row) => row.id),
      stages,
    ),
    orderFeaturedImages(rows.map((row) => row.id)),
  ]);
  const now = new Date();

  const { columns, orphanedCount } = buildColumns(stages, rows, (row, stage) => {
    const enteredAt = clockForStage(stage.slug, row.workflowStageSlug, row.stageEnteredAt);
    const { urgency, hoursInStage } = stageUrgency(stage, enteredAt, now);
    return {
      id: row.id,
      reference: row.orderNumber,
      title: row.customerName,
      subtitle: row.clubName,
      status: row.status,
      stageSlug: stage.slug,
      stageEnteredAt: enteredAt?.toISOString() ?? null,
      hoursInStage,
      urgency,
      outstandingTaskSlugs: outstanding.get(row.id) ?? [],
      value: row.orderValueAmount
        ? { amount: row.orderValueAmount, currency: row.orderValueCurrency }
        : null,
      deadlineDate: row.deadlineDate,
      featuredImageUrl: featured.get(row.id) ?? null,
    };
  });

  return { boardKey: 'order', columns, orphanedCount };
}

/** The purchase-order board. */
export async function getPurchaseOrderBoard(opts?: {
  includeCancelled?: boolean;
}): Promise<Board> {
  const stages = await listActiveStages('purchase_order');

  const rows = await db.query.purchaseOrders.findMany({
    where: opts?.includeCancelled ? undefined : ne(purchaseOrders.status, 'cancelled'),
    columns: {
      id: true,
      orderId: true,
      poNumber: true,
      customerRef: true,
      sentAt: true,
      status: true,
      awaitingApprovalAt: true,
      workflowStageSlug: true,
      stageEnteredAt: true,
      deadlineDate: true,
      createdAt: true,
    },
    with: {
      supplier: { columns: { name: true } },
      order: { columns: { orderNumber: true, customerName: true } },
    },
    orderBy: [desc(purchaseOrders.createdAt)],
  });

  const [outstanding, featured] = await Promise.all([
    loadOutstandingTasks(
      'purchase_order',
      rows.map((row) => row.id),
      stages,
    ),
    poFeaturedImages(rows.map((row) => row.id)),
  ]);
  const now = new Date();

  const { columns, orphanedCount } = buildColumns(stages, rows, (row, stage) => {
    const enteredAt = clockForStage(stage.slug, row.workflowStageSlug, row.stageEnteredAt);
    const { urgency, hoursInStage } = stageUrgency(stage, enteredAt, now);
    return {
      id: row.id,
      // The DISPLAY title (David, 2026-08-06) — composed server-side so the
      // card shows the same "2608-DY3-DAVID-BAIRD" the list and detail pages
      // do, without the client needing customerRef/sentAt on the card DTO.
      reference: poDisplayTitle(row),
      title: row.supplier?.name ?? 'Unknown supplier',
      subtitle: row.order ? `${row.order.orderNumber} · ${row.order.customerName}` : null,
      status: row.status,
      stageSlug: stage.slug,
      stageEnteredAt: enteredAt?.toISOString() ?? null,
      hoursInStage,
      urgency,
      outstandingTaskSlugs: outstanding.get(row.id) ?? [],
      value: null,
      deadlineDate: row.deadlineDate,
      supplierName: row.supplier?.name ?? null,
      orderId: row.orderId,
      awaitingApproval: row.awaitingApprovalAt !== null,
      featuredImageUrl: featured.get(row.id) ?? null,
    };
  });

  return { boardKey: 'purchase_order', columns, orphanedCount };
}

export async function getBoard(
  boardKey: WorkflowBoardKey,
  opts?: { includeCancelled?: boolean },
): Promise<Board> {
  return boardKey === 'order' ? getOrderBoard(opts) : getPurchaseOrderBoard(opts);
}

/**
 * Cards sitting in a non-terminal stage past their warn threshold — the input to
 * the stuck-job scan and the dashboard widget.
 *
 * Only rows that have actually been staged are candidates, which is what the
 * partial index on (stage_slug, stage_entered_at) is for.
 */
export async function findStuckEntities(
  boardKey: WorkflowBoardKey,
  now = new Date(),
): Promise<Array<{ entityId: string; reference: string; stageSlug: string; hoursInStage: number; urgency: StageUrgency }>> {
  const stages = await listActiveStages(boardKey);

  // `stage_entered_at is not null` matches the partial index and is also the
  // correctness condition: a row that has never been staged has no clock to be
  // measured against.
  const rows =
    boardKey === 'order'
      ? await db
          .select({
            id: orders.id,
            reference: orders.orderNumber,
            status: orders.status,
            workflowStageSlug: orders.workflowStageSlug,
            stageEnteredAt: orders.stageEnteredAt,
          })
          .from(orders)
          .where(and(ne(orders.status, 'cancelled'), isNotNull(orders.stageEnteredAt)))
      : await db
          .select({
            id: purchaseOrders.id,
            reference: purchaseOrders.poNumber,
            status: purchaseOrders.status,
            workflowStageSlug: purchaseOrders.workflowStageSlug,
            stageEnteredAt: purchaseOrders.stageEnteredAt,
          })
          .from(purchaseOrders)
          .where(
            and(
              ne(purchaseOrders.status, 'cancelled'),
              isNotNull(purchaseOrders.stageEnteredAt),
            ),
          );

  const stuck: Array<{
    entityId: string;
    reference: string;
    stageSlug: string;
    hoursInStage: number;
    urgency: StageUrgency;
  }> = [];

  for (const row of rows) {
    const stage = resolveStage(stages, row.status, row.workflowStageSlug);
    if (!stage || stage.isTerminal) continue;
    // Same rule as the board, so the scan never flags a card the board shows as
    // fine.
    const enteredAt = clockForStage(stage.slug, row.workflowStageSlug, row.stageEnteredAt);
    const { urgency, hoursInStage } = stageUrgency(stage, enteredAt, now);
    if (urgency === 'ok' || hoursInStage === null) continue;
    stuck.push({
      entityId: row.id,
      reference: row.reference,
      stageSlug: stage.slug,
      hoursInStage,
      urgency,
    });
  }

  return stuck.sort((a, b) => b.hoursInStage - a.hoursInStage);
}
