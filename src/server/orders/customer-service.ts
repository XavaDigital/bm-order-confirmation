/**
 * Customer-facing order service — token-gated reads and the final confirmation
 * transaction. All writes go through here; route handlers hold no business logic.
 */
import { randomUUID } from 'node:crypto';
import { eq, and, isNull, ne } from 'drizzle-orm';
import { db } from '@/db';
import {
  orders,
  orderAccess,
  acknowledgments,
  confirmations,
  conversionEvents,
} from '@/db/schema';
import { hashToken } from '@/lib/tokens';
import { accessCodeMatches, isAccessCodeCookieValid } from '@/lib/access-code';
import { uploadFile, signatureKey } from '@/lib/storage';
import { emitDomainEvent } from '@/server/events/outbox';

// ---------------------------------------------------------------------------
// Full order read for customer page
// ---------------------------------------------------------------------------

export async function getOrderForCustomer(rawToken: string) {
  const access = await db.query.orderAccess.findFirst({
    where: and(
      eq(orderAccess.tokenHash, hashToken(rawToken)),
      isNull(orderAccess.revokedAt),
    ),
  });

  if (!access) return null;
  if (access.expiresAt && access.expiresAt.getTime() < Date.now()) return null;

  const order = await db.query.orders.findFirst({
    where: eq(orders.id, access.orderId),
    with: {
      garments: {
        orderBy: (g, { asc }) => [asc(g.sortOrder)],
        with: {
          sizing: { orderBy: (s, { asc }) => [asc(s.sortOrder)] },
          images: { orderBy: (img, { asc }) => [asc(img.sortOrder)] },
          sizeChartLinks: { with: { sizeChart: true } },
        },
      },
    },
  });

  if (!order) return null;
  return { order, access };
}

// ---------------------------------------------------------------------------
// Per-order access code verification
// ---------------------------------------------------------------------------

/**
 * Check a customer-entered access code against the active link's stored hash.
 * Route sets the signed verification cookie on 'ok' (see /api/o/verify-code).
 */
export async function verifyOrderAccessCode(params: {
  rawToken: string;
  code: string;
}): Promise<
  | { status: 'ok'; access: { id: string; accessCodeHash: string | null } }
  | { status: 'invalid_token' }
  | { status: 'wrong_code' }
> {
  const access = await db.query.orderAccess.findFirst({
    where: and(
      eq(orderAccess.tokenHash, hashToken(params.rawToken)),
      isNull(orderAccess.revokedAt),
    ),
  });

  if (!access) return { status: 'invalid_token' };
  if (access.expiresAt && access.expiresAt.getTime() < Date.now()) {
    return { status: 'invalid_token' };
  }

  // No code enabled on this link — nothing to verify.
  if (!access.accessCodeHash) {
    return { status: 'ok', access: { id: access.id, accessCodeHash: null } };
  }

  const matches = await accessCodeMatches(params.code, access.accessCodeHash);
  if (!matches) return { status: 'wrong_code' };

  return { status: 'ok', access: { id: access.id, accessCodeHash: access.accessCodeHash } };
}

/** Throws 'code_required' unless the request carries a valid verification cookie. */
function assertAccessCodeSatisfied(
  access: { id: string; accessCodeHash: string | null },
  codeCookie: string | null | undefined,
): void {
  if (access.accessCodeHash && !isAccessCodeCookieValid(access, codeCookie)) {
    throw new Error('code_required');
  }
}

// ---------------------------------------------------------------------------
// Mark order as viewed (on every page load — idempotent status transition)
// ---------------------------------------------------------------------------

export async function recordOrderViewed(
  orderId: string,
  accessId: string,
  currentStatus: string,
) {
  await db.transaction(async (tx) => {
    await tx
      .update(orderAccess)
      .set({ lastViewedAt: new Date() })
      .where(eq(orderAccess.id, accessId));

    // Only transition to 'viewed' on the first visit (status is 'sent').
    if (currentStatus === 'sent') {
      await tx
        .update(orders)
        .set({ status: 'viewed', updatedAt: new Date() })
        .where(and(eq(orders.id, orderId), eq(orders.status, 'sent')));

      await emitDomainEvent(tx, {
        aggregateId: orderId,
        eventType: 'order.viewed',
        payload: { orderId },
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Confirmation
// ---------------------------------------------------------------------------

export const REQUIRED_ACK_KEYS = [
  'mockup_correct',
  'sizing_correct',
  'fabrics_accepted',
  'delivery_noted',
  'no_changes',
  'payment_terms',
  'authorised',
] as const;

export const ACK_TEXT_VERSION = 'v1';

export interface AckInput {
  key: string;
  text: string;
}

// ---------------------------------------------------------------------------
// Changes requested
// ---------------------------------------------------------------------------

export async function requestOrderChanges(params: {
  rawToken: string;
  comment: string;
  /** Signed verification cookie value — required when the link has an access code. */
  codeCookie?: string | null;
}): Promise<{ orderNumber: string; orderId: string }> {
  const access = await db.query.orderAccess.findFirst({
    where: and(
      eq(orderAccess.tokenHash, hashToken(params.rawToken)),
      isNull(orderAccess.revokedAt),
    ),
  });

  if (!access) throw new Error('invalid_token');
  if (access.expiresAt && access.expiresAt.getTime() < Date.now()) {
    throw new Error('invalid_token');
  }
  assertAccessCodeSatisfied(access, params.codeCookie);

  const order = await db.query.orders.findFirst({
    where: eq(orders.id, access.orderId),
  });

  if (!order) throw new Error('invalid_token');
  if (order.status === 'confirmed') throw new Error('already_confirmed');

  await db.transaction(async (tx) => {
    // Guard against racing a concurrent confirmOrder() on the same token
    // (see confirmOrder's identical guard below): the WHERE clause + row lock
    // from this UPDATE mean a confirmation that commits first is never
    // overwritten by a change-request that read the pre-confirmation status.
    const updated = await tx
      .update(orders)
      .set({ status: 'changes_requested', updatedAt: new Date() })
      .where(and(eq(orders.id, order.id), ne(orders.status, 'confirmed')))
      .returning({ id: orders.id });

    if (updated.length === 0) throw new Error('already_confirmed');

    await emitDomainEvent(tx, {
      aggregateId: order.id,
      eventType: 'order.changes_requested',
      payload: { comment: params.comment, orderNumber: order.orderNumber, customerEmail: order.customerEmail },
    });
  });

  return { orderNumber: order.orderNumber, orderId: order.id };
}

// ---------------------------------------------------------------------------
// Confirmation
// ---------------------------------------------------------------------------

export async function confirmOrder(params: {
  rawToken: string;
  acks: AckInput[];
  concerns?: string | null;
  shippingAddress?: Record<string, unknown> | null;
  signatureBase64?: string | null;
  signatureType: 'drawn' | 'uploaded' | 'none';
  ipAddress?: string | null;
  userAgent?: string | null;
  /** Signed verification cookie value — required when the link has an access code. */
  codeCookie?: string | null;
}): Promise<{ orderNumber: string; confirmedAt: Date; orderId: string }> {
  const access = await db.query.orderAccess.findFirst({
    where: and(
      eq(orderAccess.tokenHash, hashToken(params.rawToken)),
      isNull(orderAccess.revokedAt),
    ),
  });

  if (!access) throw new Error('invalid_token');
  if (access.expiresAt && access.expiresAt.getTime() < Date.now()) {
    throw new Error('invalid_token');
  }
  assertAccessCodeSatisfied(access, params.codeCookie);

  const order = await db.query.orders.findFirst({
    where: eq(orders.id, access.orderId),
    with: {
      garments: {
        orderBy: (g, { asc }) => [asc(g.sortOrder)],
        with: {
          sizing: { orderBy: (s, { asc }) => [asc(s.sortOrder)] },
          images: true,
          sizeChartLinks: { with: { sizeChart: true } },
        },
      },
    },
  });

  if (!order) throw new Error('invalid_token');
  if (order.status === 'confirmed') throw new Error('already_confirmed');

  // Validate all 7 required acks are present
  const providedKeys = new Set(params.acks.map((a) => a.key));
  for (const key of REQUIRED_ACK_KEYS) {
    if (!providedKeys.has(key)) throw new Error(`missing_ack:${key}`);
  }

  // Upload signature outside transaction (S3 side effect)
  let sigKey: string | null = null;
  if (params.signatureBase64 && params.signatureType !== 'none') {
    const b64 = params.signatureBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(b64, 'base64');
    sigKey = signatureKey(order.id, `${randomUUID()}.png`);
    await uploadFile(sigKey, buffer, 'image/png');
  }

  const confirmedAt = new Date();

  const snapshot = {
    order_number: order.orderNumber,
    customer_name: order.customerName,
    club_name: order.clubName,
    order_value_amount: order.orderValueAmount,
    order_value_currency: order.orderValueCurrency,
    expected_ship_date: order.expectedShipDate,
    deadline_date: order.deadlineDate,
    invoice_url: order.invoiceUrl,
    general_notes: order.generalNotes,
    customer_concerns: params.concerns ?? null,
    garments: order.garments.map((g) => ({
      name: g.name,
      fabrics: g.fabrics,
      notes: g.notes,
      sizing: g.sizing.map((s) => ({
        size: s.size,
        player_name: s.playerName,
        player_number: s.playerNumber,
        notes: s.notes,
      })),
      size_chart_names: g.sizeChartLinks
        .map((l) => l.sizeChart?.name)
        .filter(Boolean),
      mockup_image_captions: g.images.map((i) => i.caption).filter(Boolean),
    })),
    shipping_address:
      params.shippingAddress ?? order.shippingAddress ?? null,
  };

  await db.transaction(async (tx) => {
    // Guard against a concurrent double-confirmation (double-click, retried
    // request): the WHERE clause + row lock from this UPDATE mean only one
    // concurrent transaction can ever see `updated.length > 0` for a given
    // order — the loser's UPDATE re-evaluates the WHERE clause against the
    // winner's committed row and affects zero rows.
    const updated = await tx
      .update(orders)
      .set({ status: 'confirmed', confirmedAt, updatedAt: confirmedAt })
      .where(and(eq(orders.id, order.id), ne(orders.status, 'confirmed')))
      .returning({ id: orders.id });

    if (updated.length === 0) throw new Error('already_confirmed');

    // a. Write acknowledgments (upsert — safe if somehow called twice)
    await tx
      .insert(acknowledgments)
      .values(
        params.acks.map((a) => ({
          orderId: order.id,
          ackKey: a.key,
          ackTextVersion: ACK_TEXT_VERSION,
          accepted: true,
          acceptedAt: confirmedAt,
        })),
      )
      .onConflictDoUpdate({
        target: [acknowledgments.orderId, acknowledgments.ackKey],
        set: { accepted: true, acceptedAt: confirmedAt, ackTextVersion: ACK_TEXT_VERSION },
      });

    // b. Upsert shipping address if customer supplies it
    if (order.shippingMode === 'customer_entered' && params.shippingAddress) {
      await tx
        .update(orders)
        .set({ shippingAddress: params.shippingAddress, updatedAt: confirmedAt })
        .where(eq(orders.id, order.id));
    }

    // d+e. Confirmation row with immutable snapshot
    await tx.insert(confirmations).values({
      orderId: order.id,
      signatureType: params.signatureType,
      signatureStorageKey: sigKey,
      confirmedSnapshot: snapshot,
      confirmedAt,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
    });

    // f. Conversion event — idempotent record of the intent to fire.
    // firedAt = confirmation timestamp. Status is set to 'sent' by fireGoogleAdsConversion()
    // (src/server/conversions/google-ads.ts) once the API call succeeds; 'failed' on error.
    // The GTM client-side push (gtm.ts) is a redundant fallback.
    await tx.insert(conversionEvents).values({
      orderId: order.id,
      valueAmount: order.orderValueAmount,
      valueCurrency: order.orderValueCurrency ?? 'NZD',
      firedAt: confirmedAt,
    });

    // g. Domain event
    await emitDomainEvent(tx, {
      aggregateId: order.id,
      eventType: 'order.confirmed',
      payload: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        customerEmail: order.customerEmail,
        valueAmount: order.orderValueAmount,
        valueCurrency: order.orderValueCurrency,
      },
    });

    // i. Update last viewed
    await tx
      .update(orderAccess)
      .set({ lastViewedAt: confirmedAt })
      .where(eq(orderAccess.id, access.id));
  });

  return { orderNumber: order.orderNumber, confirmedAt, orderId: order.id };
}
