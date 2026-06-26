/**
 * Customer-facing order service — token-gated reads and the final confirmation
 * transaction. All writes go through here; route handlers hold no business logic.
 */
import { randomUUID } from 'node:crypto';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '@/db';
import {
  orders,
  orderAccess,
  acknowledgments,
  confirmations,
  conversionEvents,
} from '@/db/schema';
import { hashToken } from '@/lib/tokens';
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
}): Promise<{ orderNumber: string }> {
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

  const order = await db.query.orders.findFirst({
    where: eq(orders.id, access.orderId),
  });

  if (!order) throw new Error('invalid_token');
  if (order.status === 'confirmed') throw new Error('already_confirmed');

  await db.transaction(async (tx) => {
    await tx
      .update(orders)
      .set({ status: 'changes_requested', updatedAt: new Date() })
      .where(eq(orders.id, order.id));

    await emitDomainEvent(tx, {
      aggregateId: order.id,
      eventType: 'order.changes_requested',
      payload: { comment: params.comment, customerEmail: order.customerEmail },
    });
  });

  return { orderNumber: order.orderNumber };
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
    // firedAt = when we emitted the GTM dataLayer push (client fires immediately after this).
    // status stays 'pending' until server-side Enhanced Conversions API is implemented (Phase 7+).
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

    // h. Mark order confirmed
    await tx
      .update(orders)
      .set({ status: 'confirmed', confirmedAt, updatedAt: confirmedAt })
      .where(eq(orders.id, order.id));

    // i. Update last viewed
    await tx
      .update(orderAccess)
      .set({ lastViewedAt: confirmedAt })
      .where(eq(orderAccess.id, access.id));
  });

  return { orderNumber: order.orderNumber, confirmedAt, orderId: order.id };
}
