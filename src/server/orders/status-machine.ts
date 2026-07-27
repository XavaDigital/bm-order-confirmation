/**
 * The order status lifecycle, as a pure function — mirroring what
 * `canTransition` already does for purchase orders (`purchase-orders/contract.ts`).
 *
 * Orders previously had no such thing: guards were ad-hoc SQL conditions inside
 * whichever service happened to care, and `PATCH /api/admin/orders/[id]` wrote
 * `status` straight through. A confirmed order could be reverted to draft
 * silently, emitting no event — the customer's signature still on file while the
 * order claimed to be unsent.
 *
 * TWO separate questions live here, deliberately not conflated:
 *
 *  - `canTransitionOrder(from, to)` — is this edge legal in the lifecycle at all?
 *    `confirmOrder` / `markViewed` / `requestChanges` keep their own richer
 *    guards (they check tokens, snapshots and roster locks too) and are NOT
 *    retrofitted onto this; rewriting them would put the customer surface at
 *    risk for no gain.
 *  - `isStaffMovable(from, to)` — may a human dragging a card on the board
 *    perform it? Strictly narrower: confirmation is the CUSTOMER's act, so no
 *    amount of dragging should be able to forge it.
 */
import type { OrderStatus } from '@/lib/status';

/** Every status an order can be cancelled from — i.e. anything but itself. */
const CANCELLABLE_FROM: readonly OrderStatus[] = [
  'draft',
  'sent',
  'viewed',
  'changes_requested',
  'confirmed',
];

/**
 * Legal onward moves per status. Absent key = terminal.
 *
 * `sent` is reachable from `viewed`/`changes_requested` because re-sending a
 * link after an edit is the normal way this order gets back in front of the
 * customer.
 */
const ALLOWED: Partial<Record<OrderStatus, readonly OrderStatus[]>> = {
  draft: ['sent'],
  sent: ['viewed', 'changes_requested', 'confirmed'],
  viewed: ['sent', 'changes_requested', 'confirmed'],
  changes_requested: ['sent', 'viewed', 'confirmed'],
  // Otherwise final. Re-opening a confirmed order is a reprint or a new order,
  // not a status edit — the confirmation snapshot has to stay meaningful.
  confirmed: [],
  cancelled: [],
};

/** Is this a legal lifecycle edge? Same-status is always allowed (idempotent). */
export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return true;
  if (to === 'cancelled') return CANCELLABLE_FROM.includes(from);
  return (ALLOWED[from] ?? []).includes(to);
}

/**
 * Statuses a staff member may never move an order INTO by hand, whatever the
 * lifecycle permits.
 *
 * `confirmed` is the customer's signature — it may only be reached through
 * `confirmOrder`, which records the snapshot, the signature and the audit trail.
 * `viewed` is likewise an observed fact (the customer opened the link), not a
 * thing to assert on their behalf.
 */
const STAFF_FORBIDDEN_TARGETS: readonly OrderStatus[] = ['confirmed', 'viewed'];

/** May a human dragging a card perform this transition? */
export function isStaffMovable(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return true;
  if (STAFF_FORBIDDEN_TARGETS.includes(to)) return false;
  return canTransitionOrder(from, to);
}

/**
 * Why a transition was refused, for the 409 body — a bare "illegal move" leaves
 * the person guessing which of the two reasons applied.
 */
export function explainOrderTransition(from: OrderStatus, to: OrderStatus): string | null {
  if (canTransitionOrder(from, to) && isStaffMovable(from, to)) return null;
  if (to === 'confirmed') {
    return 'Only the customer can confirm an order, through their confirmation link.';
  }
  if (to === 'viewed') {
    return 'An order becomes "viewed" when the customer opens their link.';
  }
  if (from === 'cancelled') {
    return 'A cancelled order cannot be moved. Duplicate it instead.';
  }
  if (from === 'confirmed') {
    return 'A confirmed order can only be cancelled — raise a reprint for repeat work.';
  }
  return `Cannot move an order from ${from} to ${to}.`;
}
