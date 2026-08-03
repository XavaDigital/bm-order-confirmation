/**
 * Customer-facing order service — token-gated reads and the final confirmation
 * transaction. All writes go through here; route handlers hold no business logic.
 */
import { randomUUID } from 'node:crypto';
import { eq, and, isNull, ne } from 'drizzle-orm';
import { db } from '@/db';
import {
  type AckKey,
  orders,
  orderAccess,
  acknowledgments,
  confirmations,
  conversionEvents,
  rosterMembers,
} from '@/db/schema';
import { resolveActiveToken } from '@/server/access/tokens';
import { accessCodeMatches, isAccessCodeCookieValid } from '@/lib/access-code';
import { uploadFile, signatureKey } from '@/lib/storage';
import { emitOrderEvent } from '@/server/events/outbox';
import { toGarmentDto } from './mappers';

// ---------------------------------------------------------------------------
// Full order read for customer page
// ---------------------------------------------------------------------------

export async function getOrderForCustomer(rawToken: string) {
  const access = await resolveActiveToken(orderAccess, rawToken);
  if (!access) return null;

  const order = await db.query.orders.findFirst({
    where: eq(orders.id, access.orderId),
    with: {
      garments: {
        orderBy: (g, { asc }) => [asc(g.sortOrder)],
        with: {
          sizing: { orderBy: (s, { asc }) => [asc(s.sortOrder)] },
          images: { orderBy: (img, { asc }) => [asc(img.sortOrder)] },
          sizeChartLinks: { with: { sizeChart: true } },
          garmentType: { columns: { name: true } },
        },
      },
      rosterMembers: {
        columns: {
          id: true,
          submittedAt: true,
        },
      },
    },
  });

  if (!order) return null;

  const rosterTotal = order.rosterMembers.length;
  const rosterSubmitted = order.rosterMembers.filter((member) => member.submittedAt !== null).length;

  return {
    order: {
      ...order,
      rosterSummary: {
        total: rosterTotal,
        submitted: rosterSubmitted,
        pending: Math.max(rosterTotal - rosterSubmitted, 0),
      },
    },
    access,
  };
}

// ---------------------------------------------------------------------------
// Confirmed-order PDF (roadmap 7.2) — reuses the same active token as the
// confirmation page, so the download link keeps working after confirmation
// (confirmOrder() never revokes the token). Deliberately narrower than
// getOrderForCustomer(): no images/roster, since OrderPdf.tsx renders neither.
// ---------------------------------------------------------------------------

export async function getConfirmedOrderForPdf(
  rawToken: string,
  codeCookie: string | null | undefined,
) {
  const access = await resolveActiveToken(orderAccess, rawToken);
  if (!access) throw new Error('invalid_token');
  assertAccessCodeSatisfied(access, codeCookie);

  const order = await db.query.orders.findFirst({
    where: eq(orders.id, access.orderId),
    with: {
      garments: {
        orderBy: (g, { asc }) => [asc(g.sortOrder)],
        with: {
          sizing: { orderBy: (s, { asc }) => [asc(s.sortOrder)] },
        },
      },
    },
  });

  if (!order) throw new Error('invalid_token');
  // Not revealed as a distinct reason — the download link only ever appears
  // on the page once the order is confirmed, so this is a stale-link edge case.
  if (order.status !== 'confirmed') throw new Error('invalid_token');

  return order;
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
  const access = await resolveActiveToken(orderAccess, params.rawToken);
  if (!access) return { status: 'invalid_token' };

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

      await emitOrderEvent(tx, {
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

/**
 * The seeded default acknowledgment keys (migration 0031). The LIVE required
 * set is the active `acknowledgement_settings` rows — this constant only
 * remains because tests build their fixtures from it, and the test DB replays
 * the same seed. Do not use it in product code.
 */
export const REQUIRED_ACK_KEYS = [
  'color_accuracy',
  'color_matching',
  'mockup_correct',
  'sizing_correct',
  'size_charts_used',
  'no_refunds',
  'womens_unisex_sizing',
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
  const access = await resolveActiveToken(orderAccess, params.rawToken);
  if (!access) throw new Error('invalid_token');
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

    await emitOrderEvent(tx, {
      aggregateId: order.id,
      eventType: 'order.changes_requested',
      payload: { comment: params.comment, orderNumber: order.orderNumber, customerEmail: order.customerEmail },
    });
  });

  return { orderNumber: order.orderNumber, orderId: order.id };
}

// ---------------------------------------------------------------------------
// Colour book / physical sample request (BRIEF §5 ack 2, §11) — a standalone
// action, deliberately independent of confirmOrder(). It's an escalation path
// for customers who are highly concerned about colour matching, not something
// that should be reachable by ticking through the acknowledgment list.
// ---------------------------------------------------------------------------

export async function requestColorSample(params: {
  rawToken: string;
  /** Signed verification cookie value — required when the link has an access code. */
  codeCookie?: string | null;
}): Promise<{ orderNumber: string; orderId: string; alreadyRequested: boolean }> {
  const access = await resolveActiveToken(orderAccess, params.rawToken);
  if (!access) throw new Error('invalid_token');
  assertAccessCodeSatisfied(access, params.codeCookie);

  const order = await db.query.orders.findFirst({
    where: eq(orders.id, access.orderId),
  });

  if (!order) throw new Error('invalid_token');
  if (order.status === 'confirmed') throw new Error('already_confirmed');

  // Idempotent: a double-click or retried request should not re-notify staff.
  if (order.colorSampleRequestedAt) {
    return { orderNumber: order.orderNumber, orderId: order.id, alreadyRequested: true };
  }

  await db.transaction(async (tx) => {
    // WHERE guard mirrors confirmOrder/requestOrderChanges: prevents a race
    // against a concurrent confirm (order already gone to 'confirmed') or a
    // concurrent duplicate request from emitting a second event.
    const updated = await tx
      .update(orders)
      .set({ colorSampleRequestedAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(orders.id, order.id),
        ne(orders.status, 'confirmed'),
        isNull(orders.colorSampleRequestedAt),
      ))
      .returning({ id: orders.id });

    if (updated.length === 0) return;

    await emitOrderEvent(tx, {
      aggregateId: order.id,
      eventType: 'order.color_sample_requested',
      payload: { orderId: order.id, orderNumber: order.orderNumber, customerEmail: order.customerEmail },
    });
  });

  return { orderNumber: order.orderNumber, orderId: order.id, alreadyRequested: false };
}

// ---------------------------------------------------------------------------
// Confirmation
// ---------------------------------------------------------------------------

/** The order shape (with garment relations) the snapshot builder needs. */
interface ConfirmableOrder {
  orderNumber: string;
  customerName: string;
  clubName: string | null;
  orderValueAmount: string | null;
  orderValueCurrency: string | null;
  expectedShipDate: string | null;
  deadlineDate: string | null;
  invoiceUrl: string | null;
  generalNotes: string | null;
  colorSampleRequestedAt: Date | null;
  shippingAddress: Record<string, unknown> | null;
  garments: Array<
    Parameters<typeof toGarmentDto>[0] & {
      sizeChartLinks: { sizeChart: { name: string } | null }[];
      images: { caption: string | null }[];
    }
  >;
}

/**
 * Build the immutable `confirmed_snapshot` jsonb — the durable record of what
 * the customer actually agreed to. Pure (no I/O); exported for tests.
 * Keys are camelCase.
 */
export function buildConfirmationSnapshot(
  order: ConfirmableOrder,
  params: {
    concerns?: string | null;
    shippingAddress?: Record<string, unknown> | null;
    /** The customer explicitly chose to confirm the delivery address later. */
    shippingAddressDeferred?: boolean;
  },
) {
  return {
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    clubName: order.clubName,
    orderValueAmount: order.orderValueAmount,
    orderValueCurrency: order.orderValueCurrency,
    expectedShipDate: order.expectedShipDate,
    deadlineDate: order.deadlineDate,
    invoiceUrl: order.invoiceUrl,
    generalNotes: order.generalNotes,
    customerConcerns: params.concerns ?? null,
    // Reflects a request already made via the standalone requestColorSample()
    // action (not something confirmOrder() itself can set).
    colorSampleRequested: order.colorSampleRequestedAt !== null,
    garments: order.garments.map((g) => ({
      // The snapshot is the agreed record — toGarmentDto captures the preset
      // context (garmentTypeName, selectedOptions/Fabrics) alongside sizing.
      ...toGarmentDto(g),
      sizeChartNames: g.sizeChartLinks
        .map((l) => l.sizeChart?.name)
        .filter(Boolean),
      mockupImageCaptions: g.images.map((i) => i.caption).filter(Boolean),
    })),
    shippingAddress: params.shippingAddress ?? order.shippingAddress ?? null,
    shippingAddressDeferred: params.shippingAddressDeferred === true,
  };
}

/**
 * Upload the customer's signature image (S3 side effect — call OUTSIDE the
 * confirmation transaction). Returns the storage key, or null when there is
 * nothing to upload.
 */
export async function uploadSignature(
  orderId: string,
  signatureBase64: string | null | undefined,
  signatureType: 'drawn' | 'uploaded' | 'none',
): Promise<string | null> {
  if (!signatureBase64 || signatureType === 'none') return null;
  const b64 = signatureBase64.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(b64, 'base64');
  const sigKey = signatureKey(orderId, `${randomUUID()}.png`);
  await uploadFile(sigKey, buffer, 'image/png');
  return sigKey;
}

export async function confirmOrder(params: {
  rawToken: string;
  acks: AckInput[];
  concerns?: string | null;
  shippingAddress?: Record<string, unknown> | null;
  /** The customer explicitly chose to confirm the delivery address later. */
  shippingAddressDeferred?: boolean;
  signatureBase64?: string | null;
  signatureType: 'drawn' | 'uploaded' | 'none';
  ipAddress?: string | null;
  userAgent?: string | null;
  /** Signed verification cookie value — required when the link has an access code. */
  codeCookie?: string | null;
}): Promise<{ orderNumber: string; confirmedAt: Date; orderId: string }> {
  const access = await resolveActiveToken(orderAccess, params.rawToken);
  if (!access) throw new Error('invalid_token');
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
          garmentType: { columns: { name: true } },
        },
      },
    },
  });

  if (!order) throw new Error('invalid_token');
  if (order.status === 'confirmed') throw new Error('already_confirmed');

  // Validate all required acks are present. The required SET is the ACTIVE
  // acknowledgement_settings rows (admin-editable since 2026-08-03), and the
  // agreed title/wording is taken from the TABLE, never from the client — a
  // tampered payload can't rewrite what was agreed.
  const { listActiveAcknowledgements } = await import('@/server/acknowledgements/service');
  const activeAcks = await listActiveAcknowledgements();
  const providedKeys = new Set(params.acks.map((a) => a.key));
  for (const setting of activeAcks) {
    if (!providedKeys.has(setting.key)) throw new Error(`missing_ack:${setting.key}`);
  }

  // Address requirement (David, 2026-08-03): 'customer_entered' means the
  // customer supplies the address at confirmation — or EXPLICITLY defers it
  // ("I don't know the delivery address yet"). Client validation alone let
  // orders confirm addressless with no record of a choice; the flag makes the
  // deferral a decision, not an accident.
  const addressDeferred = params.shippingAddressDeferred === true;
  if (order.shippingMode === 'customer_entered' && !addressDeferred) {
    const a = params.shippingAddress ?? {};
    const filled = (key: string) => typeof a[key] === 'string' && (a[key] as string).trim().length > 0;
    if (!filled('line1') || !filled('city') || !filled('country')) {
      throw new Error('address_required');
    }
  }

  // Upload signature outside transaction (S3 side effect)
  const sigKey = await uploadSignature(order.id, params.signatureBase64, params.signatureType);

  const confirmedAt = new Date();

  const snapshot = {
    ...buildConfirmationSnapshot(order, {
      concerns: params.concerns,
      shippingAddress: addressDeferred ? null : params.shippingAddress,
      shippingAddressDeferred: addressDeferred,
    }),
    // The agreed acknowledgments, exactly as they read at confirmation time —
    // the settings table is editable, this record is not.
    acknowledgments: activeAcks.map((a) => ({ key: a.key, title: a.title, text: a.body })),
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

    // a. Write acknowledgments (upsert — safe if somehow called twice).
    // Rows come from the ACTIVE settings, not the client payload — one row
    // per required acknowledgment actually in force at confirmation time.
    await tx
      .insert(acknowledgments)
      .values(
        activeAcks.map((a) => ({
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

    // g. Domain event. colorSampleRequested here just reflects whether a
    // request was already made via requestColorSample() before this
    // confirmation — that action emits its own order.color_sample_requested
    // event at the time it happens, not here.
    await emitOrderEvent(tx, {
      aggregateId: order.id,
      eventType: 'order.confirmed',
      payload: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        customerEmail: order.customerEmail,
        valueAmount: order.orderValueAmount,
        valueCurrency: order.orderValueCurrency,
        colorSampleRequested: order.colorSampleRequestedAt !== null,
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
