/**
 * Re-confirmation, the DB half (David, 2026-08-07). The pure comparison lives
 * in `reconfirmation.ts`; this loads what it needs and records the asking.
 *
 * David's ruling on the shape: the system detects and flags, staff decide
 * whether to re-ask — "sometimes you've already phoned them". So nothing here
 * requests anything on its own; `getReconfirmationState` only reports.
 */
import { and, desc, eq } from 'drizzle-orm';
import type { db as database, Transaction } from '@/db';
import { db } from '@/db';
import { confirmations, orders } from '@/db/schema';
import { emitOrderEvent, recordAuditEvent } from '@/server/events/outbox';
import { buildConfirmationSnapshot, loadConfirmableOrder } from './customer-service';
import { diffAgainstConfirmation, type OrderChange } from './reconfirmation';
import { ConflictError, NotFoundError } from './service';

export type ReconfirmationStatus =
  /** Never confirmed — this feature has nothing to say about it. */
  | 'not_confirmed'
  /** The customer has agreed to the order as it stands. */
  | 'in_sync'
  /** Edited since they agreed, but only in ways that do not change the deal. */
  | 'minor_changes'
  /** Edited in ways they have not agreed to. Holds the purchase order. */
  | 'drifted'
  /** We have asked them to agree again and are waiting. */
  | 'awaiting_customer';

export interface ReconfirmationState {
  status: ReconfirmationStatus;
  changes: OrderChange[];
  hasMaterialChanges: boolean;
  /** Which agreement is in force — 1 for a single confirmation. */
  confirmedRevision: number | null;
  confirmedAt: Date | null;
  requestedAt: Date | null;
  requestedBy: string | null;
  requestedNote: string | null;
}

type Executor = Transaction | typeof database;

/**
 * The agreement in force: the HIGHEST revision, never `findFirst`. An order can
 * hold several confirmations now, and the earliest one is the least useful
 * answer to "what did they agree to".
 */
export async function latestConfirmation(orderId: string, executor: Executor = db) {
  const [row] = await executor
    .select()
    .from(confirmations)
    .where(eq(confirmations.orderId, orderId))
    .orderBy(desc(confirmations.revision))
    .limit(1);
  return row ?? null;
}

/**
 * Where this order stands relative to what the customer agreed to.
 *
 * Deliberately derived on read rather than tracked on write: see the header of
 * `reconfirmation.ts` for why a stored "changed" flag would rot.
 */
export async function getReconfirmationState(orderId: string): Promise<ReconfirmationState> {
  // The SAME loader the confirmation itself uses — a second query literal here
  // projected the relations subtly differently and reported sizing as changed
  // on orders nobody had touched.
  const order = await loadConfirmableOrder(orderId);
  if (!order) throw new NotFoundError('Order');

  const confirmation = await latestConfirmation(orderId);
  const empty = {
    changes: [] as OrderChange[],
    hasMaterialChanges: false,
    confirmedRevision: confirmation?.revision ?? null,
    confirmedAt: confirmation?.confirmedAt ?? null,
    requestedAt: order.reconfirmRequestedAt,
    requestedBy: order.reconfirmRequestedBy,
    requestedNote: order.reconfirmRequestedNote,
  };

  if (!confirmation) return { ...empty, status: 'not_confirmed' };

  const current = buildConfirmationSnapshot(order, {
    concerns: null,
    // null falls back to the order's own address inside the builder, which is
    // what "as it stands now" means.
    shippingAddress: null,
  });
  const diff = diffAgainstConfirmation(confirmation.confirmedSnapshot, current);

  // Asked-and-waiting outranks the diff: staff may have asked over a change the
  // detector calls minor, and the banner should say what is actually happening.
  if (order.reconfirmRequestedAt) {
    return { ...empty, ...diff, status: 'awaiting_customer' };
  }
  if (diff.hasMaterialChanges) return { ...empty, ...diff, status: 'drifted' };
  if (diff.changes.length > 0) return { ...empty, ...diff, status: 'minor_changes' };
  return { ...empty, ...diff, status: 'in_sync' };
}

/**
 * Ask the customer to agree to the order as it now stands.
 *
 * Does NOT send the email — the caller does that through the existing
 * send-link path, so re-confirmation reuses the one place link emails are
 * built rather than growing a second one.
 */
export async function requestReconfirmation(
  orderId: string,
  meta: { note?: string | null; actorEmail?: string | null },
): Promise<ReconfirmationState> {
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, orderId),
    columns: { id: true, status: true, orderNumber: true, reconfirmRequestedAt: true },
  });
  if (!order) throw new NotFoundError('Order');
  if (order.status !== 'confirmed') {
    throw new ConflictError(
      'Only a confirmed order can be sent back for re-confirmation — this one has not been confirmed yet.',
    );
  }
  const existing = await latestConfirmation(orderId);
  if (!existing) {
    throw new ConflictError('This order has no confirmation on file to re-confirm.');
  }

  const requestedAt = new Date();
  const note = meta.note?.trim() || null;

  await db.transaction(async (tx) => {
    // Re-asking while already waiting just refreshes the note and the clock;
    // it is not an error, and staff do chase.
    await tx
      .update(orders)
      .set({
        reconfirmRequestedAt: requestedAt,
        reconfirmRequestedBy: meta.actorEmail ?? null,
        reconfirmRequestedNote: note,
        updatedAt: requestedAt,
      })
      .where(eq(orders.id, orderId));

    await emitOrderEvent(tx, {
      aggregateId: orderId,
      eventType: 'order.reconfirm_requested',
      payload: {
        orderId,
        orderNumber: order.orderNumber,
        fromRevision: existing.revision,
        note,
      },
    });
    await recordAuditEvent(
      {
        aggregateId: orderId,
        eventType: 'order.reconfirm_requested',
        payload: { fromRevision: existing.revision, note },
        actorEmail: meta.actorEmail ?? null,
      },
      tx,
    );
  });

  return getReconfirmationState(orderId);
}

/**
 * Withdraw the request — the customer confirmed by phone, or it was asked in
 * error. Separate from the customer confirming, which clears the flag itself.
 */
export async function cancelReconfirmationRequest(
  orderId: string,
  meta: { actorEmail?: string | null },
): Promise<ReconfirmationState> {
  const [updated] = await db
    .update(orders)
    .set({
      reconfirmRequestedAt: null,
      reconfirmRequestedBy: null,
      reconfirmRequestedNote: null,
      updatedAt: new Date(),
    })
    .where(and(eq(orders.id, orderId), eq(orders.status, 'confirmed')))
    .returning({ id: orders.id });
  if (!updated) throw new NotFoundError('Order');

  await recordAuditEvent({
    aggregateId: orderId,
    eventType: 'order.reconfirm_cancelled',
    payload: {},
    actorEmail: meta.actorEmail ?? null,
  });

  return getReconfirmationState(orderId);
}
