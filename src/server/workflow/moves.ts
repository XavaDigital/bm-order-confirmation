/**
 * Moving an entity between workflow stages.
 *
 * The invariant this module exists to hold: a move that crosses a status
 * boundary writes the stage AND the status in ONE transaction. Two transactions
 * would leave a window where a failure between them puts the board and the
 * status permanently out of step — and nobody would notice until a customer
 * asked where their order was.
 *
 * Legality is checked in two layers, because they answer different questions:
 *  - the stage layer: does the target stage exist, is it active, is it on this
 *    board;
 *  - the status layer: the existing `canTransitionOrder` / `canTransition`
 *    guards, unchanged. A stage move is never a way around them.
 */
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { orders, purchaseOrders } from '@/db/schema';
import type { WorkflowBoardKey } from '@/db/schema';
import type { OrderStatus } from '@/lib/status';
import { NotFoundError } from '@/server/orders/service';
import { recordAuditEvent } from '@/server/events/outbox';
import { explainOrderTransition, isStaffMovable } from '@/server/orders/status-machine';
import { updatePurchaseOrderStatusTx } from '@/server/purchase-orders/service';
import type { PoStatus } from '@/server/purchase-orders/contract';
import { canTransition as canTransitionPo } from '@/server/purchase-orders/contract';
import { syncOrderProductionStatus } from '@/server/purchase-orders/hub-sync';
import { listActiveStages, resolveStage, type StageRow } from './stages';

export interface MoveResult {
  entityType: WorkflowBoardKey;
  entityId: string;
  fromStageSlug: string | null;
  toStageSlug: string;
  /** Set only when the move also moved the status. */
  statusChange: { from: string; to: string } | null;
}

type ActorMeta = { actorEmail?: string | null };

/**
 * A refused move carries the outstanding reason on `details` so the UI can list
 * it instead of showing a bare "illegal move". `defineRoute` maps
 * `*ConflictError` to 409 and passes `details` through.
 */
export class WorkflowMoveConflictError extends Error {
  readonly details: Record<string, unknown>;
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'WorkflowMoveConflictError';
    this.details = details;
  }
}

function assertTargetUsable(stage: StageRow | undefined, slug: string): StageRow {
  if (!stage) throw new NotFoundError('Stage');
  if (!stage.isActive) {
    throw new WorkflowMoveConflictError(`The "${stage.name}" stage is no longer in use.`, {
      stageSlug: slug,
    });
  }
  return stage;
}

/**
 * Move an ORDER to a stage.
 *
 * Crossing into another status also performs the status transition, through
 * `isStaffMovable` — deliberately stricter than the lifecycle itself, so no
 * amount of dragging can mark an order confirmed or viewed on the customer's
 * behalf.
 */
export async function moveOrderToStage(
  orderId: string,
  toStageSlug: string,
  meta?: ActorMeta,
): Promise<MoveResult> {
  const stages = await listActiveStages('order');
  const target = assertTargetUsable(
    stages.find((stage) => stage.slug === toStageSlug),
    toStageSlug,
  );

  return db.transaction(async (tx) => {
    // Lock the row: two people dragging the same card must not interleave a
    // read-modify-write on its status.
    const [order] = await tx
      .select({
        id: orders.id,
        status: orders.status,
        workflowStageSlug: orders.workflowStageSlug,
      })
      .from(orders)
      .where(eq(orders.id, orderId))
      .for('update');
    if (!order) throw new NotFoundError('Order');

    const current = resolveStage(stages, order.status, order.workflowStageSlug);
    if (current?.slug === target.slug) {
      // Already there — a dropped card that did not actually move.
      return {
        entityType: 'order' as const,
        entityId: orderId,
        fromStageSlug: current?.slug ?? null,
        toStageSlug: target.slug,
        statusChange: null,
      };
    }

    const nextStatus = target.statusKey as OrderStatus;
    const crossesStatus = nextStatus !== order.status;

    if (crossesStatus) {
      if (!isStaffMovable(order.status, nextStatus)) {
        throw new WorkflowMoveConflictError(
          explainOrderTransition(order.status, nextStatus) ??
            `Cannot move an order from ${order.status} to ${nextStatus}.`,
          { from: order.status, to: nextStatus },
        );
      }
    }

    const now = new Date();
    await tx
      .update(orders)
      .set({
        workflowStageSlug: target.slug,
        stageEnteredAt: now,
        ...(crossesStatus ? { status: nextStatus } : {}),
        updatedAt: now,
      })
      .where(eq(orders.id, orderId));

    if (current) {
      await recordAuditEvent(
        {
          aggregateId: orderId,
          eventType: 'workflow.stage_exited',
          payload: { stageSlug: current.slug, boardKey: 'order' },
          actorEmail: meta?.actorEmail ?? null,
        },
        tx,
      );
    }
    await recordAuditEvent(
      {
        aggregateId: orderId,
        eventType: 'workflow.stage_entered',
        payload: { stageSlug: target.slug, boardKey: 'order' },
        actorEmail: meta?.actorEmail ?? null,
      },
      tx,
    );
    if (crossesStatus) {
      await recordAuditEvent(
        {
          aggregateId: orderId,
          eventType: 'order.status_changed',
          payload: { from: order.status, to: nextStatus, via: 'workflow_move' },
          actorEmail: meta?.actorEmail ?? null,
        },
        tx,
      );
    }

    return {
      entityType: 'order' as const,
      entityId: orderId,
      fromStageSlug: current?.slug ?? null,
      toStageSlug: target.slug,
      statusChange: crossesStatus ? { from: order.status, to: nextStatus } : null,
    };
  });
}

/**
 * Move a PURCHASE ORDER to a stage.
 *
 * Crossing a status boundary delegates to `updatePurchaseOrderStatusTx` inside
 * this same transaction, so the PO keeps its existing guard, its outbox events
 * and its audit row, and the stage cannot drift from the status.
 */
export async function movePurchaseOrderToStage(
  poId: string,
  toStageSlug: string,
  meta?: ActorMeta,
): Promise<MoveResult> {
  const stages = await listActiveStages('purchase_order');
  const target = assertTargetUsable(
    stages.find((stage) => stage.slug === toStageSlug),
    toStageSlug,
  );

  const { result, orderId, crossed } = await db.transaction(async (tx) => {
    const [po] = await tx
      .select({
        id: purchaseOrders.id,
        orderId: purchaseOrders.orderId,
        poNumber: purchaseOrders.poNumber,
        status: purchaseOrders.status,
        sentAt: purchaseOrders.sentAt,
        workflowStageSlug: purchaseOrders.workflowStageSlug,
      })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, poId))
      .for('update');
    if (!po) throw new NotFoundError('Purchase order');

    const current = resolveStage(stages, po.status, po.workflowStageSlug);
    if (current?.slug === target.slug) {
      return {
        result: {
          entityType: 'purchase_order' as const,
          entityId: poId,
          fromStageSlug: current?.slug ?? null,
          toStageSlug: target.slug,
          statusChange: null,
        },
        orderId: po.orderId,
        crossed: false,
      };
    }

    const nextStatus = target.statusKey as PoStatus;
    const crossesStatus = nextStatus !== po.status;

    if (crossesStatus && !canTransitionPo(po.status, nextStatus)) {
      throw new WorkflowMoveConflictError(
        `Cannot move a ${po.status} purchase order to ${nextStatus}.`,
        { from: po.status, to: nextStatus },
      );
    }

    if (crossesStatus) {
      // Same transaction as the stage write — that is the point of the tx-aware
      // split. It re-checks canTransition itself, which is fine.
      await updatePurchaseOrderStatusTx(tx, po, nextStatus, meta);
    }

    const now = new Date();
    await tx
      .update(purchaseOrders)
      .set({ workflowStageSlug: target.slug, stageEnteredAt: now, updatedAt: now })
      .where(eq(purchaseOrders.id, poId));

    if (current) {
      await recordAuditEvent(
        {
          aggregateId: po.orderId,
          eventType: 'workflow.stage_exited',
          payload: { poId, stageSlug: current.slug, boardKey: 'purchase_order' },
          actorEmail: meta?.actorEmail ?? null,
        },
        tx,
      );
    }
    await recordAuditEvent(
      {
        aggregateId: po.orderId,
        eventType: 'workflow.stage_entered',
        payload: { poId, stageSlug: target.slug, boardKey: 'purchase_order' },
        actorEmail: meta?.actorEmail ?? null,
      },
      tx,
    );

    return {
      result: {
        entityType: 'purchase_order' as const,
        entityId: poId,
        fromStageSlug: current?.slug ?? null,
        toStageSlug: target.slug,
        statusChange: crossesStatus ? { from: po.status, to: nextStatus } : null,
      },
      orderId: po.orderId,
      crossed: crossesStatus,
    };
  });

  // Network write-back, so it belongs strictly after the commit — the tx-aware
  // status helper deliberately does not do this for its callers.
  if (crossed) void syncOrderProductionStatus(orderId);

  return result;
}

/** Dispatch by board, for the single move endpoint the boards both call. */
export async function moveEntityToStage(
  boardKey: WorkflowBoardKey,
  entityId: string,
  toStageSlug: string,
  meta?: ActorMeta,
): Promise<MoveResult> {
  return boardKey === 'order'
    ? moveOrderToStage(entityId, toStageSlug, meta)
    : movePurchaseOrderToStage(entityId, toStageSlug, meta);
}
