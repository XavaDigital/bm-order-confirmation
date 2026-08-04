/**
 * Order lifecycle → hub communications timeline (fleet thread
 * 2026-07-31-orders-from-email, mailflow's M3 recommendation, salesflow's
 * visibility ruling).
 *
 * The hub timeline is the customer's cross-fleet history — every sibling app
 * renders whatever lands on it. The contract is the semantic itself: push ONLY
 * what belongs on the customer's timeline: lifecycle events (created /
 * confirmed / changes_requested) and ORDER NOTES (finalisation points, kind
 * 'note') — order-scoped subjects keep the order connection obvious, David's
 * condition. Never comments/discussion, never supplier-authored or system
 * rows. Two-transport model (salesflow's 2026-08-04 reconciliation): the
 * brokered capability GET is the CURRENT-STATE list; timeline rows are
 * append-only visibility/history.
 *
 * Unlike the index snapshot push (order-sync.ts), this is an EVENT push, but
 * it is deliberately best-effort and never throws, including from outbox
 * handlers. Rationale: a strict throw would mark the whole domain event failed
 * and re-run ALL of its handlers on retry — and the confirmation email
 * handlers resend on re-run (documented gap in processor.ts). A duplicated
 * customer email is a worse failure than a missing timeline row. The hub's
 * (channel, externalRef) uniqueness makes any replay that does happen return
 * the existing row rather than duplicate it.
 */
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import type { Transaction } from '@/db';
import { orders } from '@/db/schema';
import { logger } from '@/lib/logger';
import { isHubConfigured, postHubCommunication, postHubEnvelope } from './client';
import type { AnnotationEnvelope } from './client';

export type OrderTimelineKind = 'created' | 'confirmed' | 'changes_requested';

const SNIPPET_MAX = 500; // the hub stores "first 500 chars" — pre-truncate
const ENVELOPE_BODY_MAX = 64_000; // §8: body.text ≤ 64KB; the hub re-enforces

/**
 * Pure mapping from lifecycle kind to the timeline item's rendering fields.
 * Direction is who acted: `created` is our act (outbound); `confirmed` and
 * `changes_requested` are the customer's (inbound).
 */
export function buildOrderTimelineItem(
  kind: OrderTimelineKind,
  orderNumber: string | null,
  comment?: string | null,
): { direction: 'inbound' | 'outbound'; subject: string; snippet: string | null } {
  const ref = orderNumber ? `Order ${orderNumber}` : 'Order';
  switch (kind) {
    case 'created':
      return { direction: 'outbound', subject: `${ref} created`, snippet: null };
    case 'confirmed':
      return {
        direction: 'inbound',
        subject: `${ref} confirmed`,
        snippet: 'The customer confirmed the order.',
      };
    case 'changes_requested':
      return {
        direction: 'inbound',
        subject: `${ref}: changes requested`,
        snippet: comment ? comment.slice(0, SNIPPET_MAX) : null,
      };
  }
}

/**
 * Push one lifecycle event for an order onto the hub timeline. No-op when the
 * hub seam is off or the order has no hub customer (nothing to file it under).
 *
 * `externalRef` is the idempotency key with channel='note': callers pass the
 * domain event uuid (outbox paths) or `<orderId>:created` (the create path,
 * which emits no outbox event). Takes an optional executor because outbox
 * handlers run inside the batch transaction and must not touch the global db.
 */
/** The note-row fields the envelope push needs (a subset of the table row). */
export interface OrderNoteEnvelopeInput {
  id: string;
  body: string;
  kind: 'comment' | 'note';
  authorKind: 'staff' | 'email_flow' | 'system' | 'supplier';
  authorLabel: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/**
 * THE serializer for an order note's §3 envelope — FLEET_STANDARD_ANNOTATIONS
 * §7 (one serializer, two transports): the outbox push AND the capability
 * notes GET/POST responses are all built here, so push and read-repair
 * physically cannot disagree on shape. `pushRef` is a delivery concern and is
 * added by the push, not here — record identity is the row uuid.
 */
export function buildOrderNoteEnvelope(
  orderId: string,
  note: OrderNoteEnvelopeInput,
): AnnotationEnvelope {
  const edited = note.updatedAt.getTime() - note.createdAt.getTime() > 1000;
  return {
    id: note.id,
    schemaVersion: 1,
    subject: { type: 'order', id: orderId, app: 'bm-orders' },
    kind: 'note',
    body: { text: note.body.slice(0, ENVELOPE_BODY_MAX), format: 'plain' },
    author: {
      kind:
        note.authorKind === 'supplier' || note.authorKind === 'system'
          ? note.authorKind
          : 'staff', // email_flow is a staff member acting from the email app
      label: note.authorLabel ?? 'Staff',
    },
    audience: [], // staff-only — David's pin; order notes never reach customer surfaces
    occurredAt: note.createdAt.toISOString(),
    ...(edited && { editedAt: note.updatedAt.toISOString() }),
    ...(note.deletedAt && { deletedAt: note.deletedAt.toISOString() }),
  };
}

/**
 * Push one ORDER NOTE (kind 'note') to the hub as a §3 ENVELOPE, keyed on the
 * note ROW uuid (FLEET_STANDARD_ANNOTATIONS R1 — re-keyed from the event uuid
 * once the hub's upsert-by-id went live, bm-sales rev 00064-vkc). Edits
 * converge on one hub row; a deletedAt tombstones it. Same best-effort/
 * no-throw stance as the lifecycle push; `pushRef` (the outbox event uuid)
 * dedupes redeliveries; the hub's ordering comparator makes races harmless.
 */
export async function pushOrderNoteToTimeline(
  orderId: string,
  note: OrderNoteEnvelopeInput,
  opts: { pushRef: string; executor?: Transaction },
): Promise<void> {
  const ex = opts.executor ?? db;
  try {
    if (!isHubConfigured()) return;
    if (note.kind !== 'note') return; // comments/discussion never leave the app

    // Standalone/unlinked orders have nothing to file under — and the hub
    // resolves the subject via its external-reference index, so an unlinked
    // push would only 404.
    const [order] = await ex
      .select({ hubCustomerId: orders.hubCustomerId })
      .from(orders)
      .where(eq(orders.id, orderId));
    if (!order?.hubCustomerId) return;

    const ok = await postHubEnvelope({
      ...buildOrderNoteEnvelope(orderId, note),
      pushRef: opts.pushRef,
    });
    if (!ok) {
      logger.warn('[hub/timeline] note envelope push failed (best-effort, not retried)', { orderId });
    }
  } catch (err) {
    logger.warn('[hub/timeline] note envelope push failed (best-effort, not retried)', { orderId, err });
  }
}

export async function pushOrderTimelineEvent(
  orderId: string,
  kind: OrderTimelineKind,
  opts: {
    externalRef: string;
    occurredAt: Date;
    comment?: string | null;
    executor?: Transaction;
  },
): Promise<void> {
  const ex = opts.executor ?? db;
  try {
    if (!isHubConfigured()) return;

    const [order] = await ex
      .select({
        hubCustomerId: orders.hubCustomerId,
        hubContactId: orders.hubContactId,
        hubOrderId: orders.hubOrderId,
        orderNumber: orders.orderNumber,
      })
      .from(orders)
      .where(eq(orders.id, orderId));
    if (!order?.hubCustomerId) return;

    const item = buildOrderTimelineItem(kind, order.orderNumber, opts.comment);
    const ok = await postHubCommunication({
      channel: 'note',
      direction: item.direction,
      occurredAt: opts.occurredAt,
      customerId: order.hubCustomerId,
      contactId: order.hubContactId,
      orderId: order.hubOrderId,
      externalRef: opts.externalRef,
      subject: item.subject,
      snippet: item.snippet,
    });
    if (!ok) {
      logger.warn('[hub/timeline] push failed (best-effort, not retried)', { orderId, kind });
    }
  } catch (err) {
    logger.warn('[hub/timeline] push failed (best-effort, not retried)', { orderId, kind, err });
  }
}
