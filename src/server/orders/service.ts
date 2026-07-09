/**
 * Order service — the single place orders are created and read.
 *
 * THIS IS THE INTEGRATION SEAM (PROJECT_BRIEF.md §15). The admin UI and the
 * future sales platform both go through these functions (directly, or via
 * `POST /api/orders`). All validation, token generation, and event emission live
 * here — never write order rows from a UI component or let the platform poke the
 * tables directly.
 */
import { randomBytes } from 'node:crypto';
import { eq, and, ne, isNull, isNotNull, ilike, or, asc, desc, sql, count, inArray } from 'drizzle-orm';
import { db } from '@/db';
import {
  orders,
  garments,
  garmentSizing,
  mockupImages,
  garmentSizeChartLinks,
  orderAccess,
  domainEvents,
} from '@/db/schema';
import { generateToken, hashToken, buildConfirmationUrl } from '@/lib/tokens';
import { generateAccessCode, hashAccessCode } from '@/lib/access-code';
import { STALE_THRESHOLD_DAYS } from '@/lib/config';
import { env } from '@/lib/env';
import { emitDomainEvent, recordAuditEvent } from '@/server/events/outbox';
import type { CreateOrderInput } from './contract';
import type { UpdateOrderInput, AddGarmentInput, UpdateGarmentInput, UpsertSizingInput } from './admin-contract';

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class NotFoundError extends Error {
  constructor(entity = 'Resource') {
    super(`${entity} not found`);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateOrderNumber(): string {
  return `OC-${randomBytes(4).toString('hex').toUpperCase()}`;
}

/** Null when `LINK_EXPIRY_DAYS` is unset — links never expire. */
function computeAccessExpiry(): Date | null {
  return env.LINK_EXPIRY_DAYS ? new Date(Date.now() + env.LINK_EXPIRY_DAYS * 86_400_000) : null;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export type CreateOrderResult = {
  orderId: string;
  orderNumber: string;
  /** Raw token — shown ONCE to the caller so it can build/send the link. Never stored raw. */
  token: string;
  url: string;
};

export async function createOrder(
  input: CreateOrderInput,
  createdBy?: string,
): Promise<CreateOrderResult> {
  const orderNumber = generateOrderNumber();
  const rawToken = generateToken();
  let createdOrderId = '';

  await db.transaction(async (tx) => {
    const [order] = await tx
      .insert(orders)
      .values({
        orderNumber,
        source: input.source,
        externalRef: input.externalRef,
        customerName: input.customer.name,
        customerEmail: input.customer.email,
        customerContact: input.customer.contact,
        clubName: input.customer.clubName,
        orderValueAmount: input.orderValue ? input.orderValue.amount.toFixed(2) : null,
        orderValueCurrency: input.orderValue?.currency ?? 'NZD',
        invoiceUrl: input.invoiceUrl,
        expectedShipDate: input.expectedShipDate ?? null,
        deadlineDate: input.deadlineDate ?? null,
        generalNotes: input.generalNotes,
        shippingMode: input.shipping?.mode ?? 'prefilled',
        shippingAddress: input.shipping?.address ?? null,
        status: 'draft',
        createdBy: createdBy ?? null,
      })
      .returning({ id: orders.id });

    const orderId = order.id;
    createdOrderId = orderId;

    for (const [i, g] of input.garments.entries()) {
      const [garment] = await tx
        .insert(garments)
        .values({ orderId, name: g.name, fabrics: g.fabrics ?? [], notes: g.notes, sortOrder: i })
        .returning({ id: garments.id });

      if (g.sizing?.length) {
        await tx.insert(garmentSizing).values(
          g.sizing.map((row, j) => ({
            garmentId: garment.id,
            size: row.size,
            playerName: row.playerName,
            playerNumber: row.playerNumber,
            notes: row.notes,
            sortOrder: j,
          })),
        );
      }

      if (g.mockupStorageKeys?.length) {
        await tx.insert(mockupImages).values(
          g.mockupStorageKeys.map((storageKey, j) => ({
            garmentId: garment.id,
            storageKey,
            sortOrder: j,
          })),
        );
      }

      if (g.sizeChartIds?.length) {
        await tx.insert(garmentSizeChartLinks).values(
          g.sizeChartIds.map((sizeChartId) => ({ garmentId: garment.id, sizeChartId })),
        );
      }
    }

    await tx.insert(orderAccess).values({ orderId, tokenHash: hashToken(rawToken), expiresAt: computeAccessExpiry() });
  });

  return { orderId: createdOrderId, orderNumber, token: rawToken, url: buildConfirmationUrl(rawToken) };
}

// ---------------------------------------------------------------------------
// Admin reads
// ---------------------------------------------------------------------------

type OrderSortField = 'createdAt' | 'orderValueAmount';
type OrderSortDir = 'asc' | 'desc';

function normalizeSortOptions(opts?: { sortBy?: string; sortDir?: string }) {
  const sortBy = opts?.sortBy === 'orderValueAmount' ? 'orderValueAmount' : 'createdAt';
  const sortDir = opts?.sortDir === 'asc' ? 'asc' : 'desc';
  return { sortBy: sortBy as OrderSortField, sortDir: sortDir as OrderSortDir };
}

function buildOrdersWhere(opts?: { status?: string; search?: string }) {
  return and(
    opts?.status ? eq(orders.status, opts.status as never) : undefined,
    opts?.search
      ? or(
          ilike(orders.customerName, `%${opts.search}%`),
          ilike(orders.customerEmail, `%${opts.search}%`),
          ilike(orders.orderNumber, `%${opts.search}%`),
          ilike(orders.clubName, `%${opts.search}%`),
        )
      : undefined,
  );
}

function buildOrdersOrderBy(sortBy: OrderSortField, sortDir: OrderSortDir) {
  const direction = sortDir === 'asc' ? asc : desc;

  switch (sortBy) {
    case 'orderValueAmount':
      return [direction(orders.orderValueAmount)];
    case 'createdAt':
    default:
      return [direction(orders.createdAt)];
  }
}

export async function listOrders(opts?: {
  status?: string;
  search?: string;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortDir?: string;
}) {
  const limit = opts?.limit ?? 100;
  const offset = opts?.offset ?? 0;
  const { sortBy, sortDir } = normalizeSortOptions(opts);

  const where = buildOrdersWhere(opts);

  const [rows, [{ total }]] = await Promise.all([
    db.query.orders.findMany({
      columns: {
        id: true,
        orderNumber: true,
        customerName: true,
        customerEmail: true,
        clubName: true,
        status: true,
        orderValueAmount: true,
        orderValueCurrency: true,
        createdAt: true,
        confirmedAt: true,
      },
      with: {
        access: {
          columns: { id: true, revokedAt: true },
          where: isNull(orderAccess.revokedAt),
          limit: 1,
        },
      },
      where,
      orderBy: buildOrdersOrderBy(sortBy, sortDir),
      limit,
      offset,
    }),
    db.select({ total: count() }).from(orders).where(where),
  ]);

  return {
    orders: rows.map(({ access, ...o }) => ({ ...o, hasActiveToken: access.length > 0 })),
    total: Number(total),
  };
}

/**
 * Same filtering as `listOrders()` but unpaginated — for the CSV export,
 * which should return every matching row, not just the current page.
 */
export async function listOrdersForExport(opts?: {
  status?: string;
  search?: string;
  sortBy?: string;
  sortDir?: string;
}) {
  const { sortBy, sortDir } = normalizeSortOptions(opts);

  return db
    .select({
      orderNumber: orders.orderNumber,
      customerName: orders.customerName,
      customerEmail: orders.customerEmail,
      clubName: orders.clubName,
      status: orders.status,
      orderValueAmount: orders.orderValueAmount,
      orderValueCurrency: orders.orderValueCurrency,
      createdAt: orders.createdAt,
      confirmedAt: orders.confirmedAt,
    })
    .from(orders)
    .where(buildOrdersWhere(opts))
    .orderBy(...buildOrdersOrderBy(sortBy, sortDir));
}

export type StaleOrder = {
  id: string;
  orderNumber: string;
  customerName: string;
  clubName: string | null;
  status: 'sent' | 'viewed';
  /** Last customer-facing action (link emailed / order viewed), not `orders.updatedAt`. */
  staleSince: string;
  daysStale: number;
};

/**
 * Orders sitting in 'sent' or 'viewed' past their staleness threshold, i.e.
 * emailed/opened but the customer hasn't confirmed or requested changes since.
 *
 * Uses `domain_events` (`link.emailed` / `order.viewed` / `token.generated`)
 * as the "clock start" rather than `orders.updatedAt`, since `updatedAt` is
 * also bumped by unrelated admin edits (see FEATURE_PROPOSALS.md #1).
 */
export async function getStaleOrders(limit = 10): Promise<StaleOrder[]> {
  const candidates = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      customerName: orders.customerName,
      clubName: orders.clubName,
      status: orders.status,
      updatedAt: orders.updatedAt,
    })
    .from(orders)
    .where(or(eq(orders.status, 'sent'), eq(orders.status, 'viewed')));

  if (candidates.length === 0) return [];

  const orderIds = candidates.map((o) => o.id);

  const events = await db
    .select({
      aggregateId: domainEvents.aggregateId,
      createdAt: domainEvents.createdAt,
    })
    .from(domainEvents)
    .where(
      and(
        inArray(domainEvents.aggregateId, orderIds),
        inArray(domainEvents.eventType, ['link.emailed', 'order.viewed', 'token.generated']),
      ),
    )
    .orderBy(desc(domainEvents.createdAt));

  const lastEventByOrder = new Map<string, Date>();
  for (const e of events) {
    if (!lastEventByOrder.has(e.aggregateId)) {
      lastEventByOrder.set(e.aggregateId, e.createdAt);
    }
  }

  const now = Date.now();
  const msPerDay = 1000 * 60 * 60 * 24;

  const stale: StaleOrder[] = [];
  for (const o of candidates) {
    const status = o.status as 'sent' | 'viewed';
    const clockStart = lastEventByOrder.get(o.id) ?? o.updatedAt;
    const daysStale = Math.floor((now - clockStart.getTime()) / msPerDay);
    if (daysStale >= STALE_THRESHOLD_DAYS[status]) {
      stale.push({
        id: o.id,
        orderNumber: o.orderNumber,
        customerName: o.customerName,
        clubName: o.clubName,
        status,
        staleSince: clockStart.toISOString(),
        daysStale,
      });
    }
  }

  return stale.sort((a, b) => b.daysStale - a.daysStale).slice(0, limit);
}

export async function getOrderAdmin(id: string) {
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, id),
    with: {
      garments: {
        orderBy: (g, { asc }) => [asc(g.sortOrder)],
        with: {
          sizing: { orderBy: (s, { asc }) => [asc(s.sortOrder)] },
          images: { orderBy: (i, { asc }) => [asc(i.sortOrder)] },
          sizeChartLinks: true,
        },
      },
    },
  });

  if (!order) return null;

  const currentAccess = await db.query.orderAccess.findFirst({
    where: and(eq(orderAccess.orderId, id), isNull(orderAccess.revokedAt)),
    orderBy: [desc(orderAccess.createdAt)],
  });

  return { ...order, currentAccess: currentAccess ?? null };
}

export async function getOrderById(id: string) {
  return db.query.orders.findFirst({ where: eq(orders.id, id) });
}

/**
 * Create a new draft order pre-filled from an existing one — for repeat
 * customers re-ordering the same/similar kit. Structured like `createOrder()`
 * but sources its values from a fetched order instead of a `CreateOrderInput`.
 *
 * Deliberately NOT copied onto the duplicate:
 * - status/confirmedAt/confirmations/conversionEvents/domainEvents — the
 *   duplicate is a brand-new order and must start at 'draft' with no history.
 * - mock-up images — storage keys are namespaced per-order
 *   (`mockupKey(orderId, ...)`, `src/lib/storage.ts`), so copying the row
 *   would point at the source order's S3 object. Staff re-upload as needed.
 * - externalRef — has a partial unique index and ties an order to a specific
 *   record in the future sales platform; copying it verbatim would either
 *   collision-fail the insert or misattribute the duplicate.
 * - internalNotes — staff context tied to what happened on the *original*
 *   order (e.g. "third reprint due to fabric issue") that would be stale and
 *   potentially misleading if silently carried onto a new order.
 * - orderNumber — freshly generated; it's `unique()` and reusing it would
 *   fail the insert outright.
 *
 * Customer name/email/club/shipping ARE copied — a re-order for the same
 * customer/club is the more common case for this business, and staff can
 * clear fields that don't apply before sending.
 *
 * Reads the source via `getOrderAdmin()`, which always reflects current
 * state (not a historical snapshot) — so duplicating an order that's
 * `changes_requested` automatically picks up whatever staff already edited
 * in response to the customer's feedback, with no special-casing needed.
 */
export async function duplicateOrder(
  id: string,
  createdBy?: string,
  meta?: { actorEmail?: string },
): Promise<CreateOrderResult> {
  const source = await getOrderAdmin(id);
  if (!source) throw new NotFoundError('Order');

  const orderNumber = generateOrderNumber();
  const rawToken = generateToken();
  let createdOrderId = '';

  await db.transaction(async (tx) => {
    const [order] = await tx
      .insert(orders)
      .values({
        orderNumber,
        source: 'internal_admin',
        externalRef: null,
        customerName: source.customerName,
        customerEmail: source.customerEmail,
        customerContact: source.customerContact,
        clubName: source.clubName,
        orderValueAmount: source.orderValueAmount,
        orderValueCurrency: source.orderValueCurrency,
        invoiceUrl: source.invoiceUrl,
        expectedShipDate: source.expectedShipDate,
        deadlineDate: source.deadlineDate,
        generalNotes: source.generalNotes,
        shippingMode: source.shippingMode,
        shippingAddress: source.shippingAddress,
        status: 'draft',
        createdBy: createdBy ?? null,
      })
      .returning({ id: orders.id });

    const orderId = order.id;
    createdOrderId = orderId;

    for (const g of source.garments) {
      const [garment] = await tx
        .insert(garments)
        .values({
          orderId,
          name: g.name,
          fabrics: Array.isArray(g.fabrics) ? g.fabrics : [],
          notes: g.notes,
          sortOrder: g.sortOrder,
        })
        .returning({ id: garments.id });

      if (g.sizing.length) {
        await tx.insert(garmentSizing).values(
          g.sizing.map((row) => ({
            garmentId: garment.id,
            size: row.size,
            playerName: row.playerName,
            playerNumber: row.playerNumber,
            notes: row.notes,
            sortOrder: row.sortOrder,
          })),
        );
      }

      if (g.sizeChartLinks.length) {
        await tx.insert(garmentSizeChartLinks).values(
          g.sizeChartLinks.map((l) => ({ garmentId: garment.id, sizeChartId: l.sizeChartId })),
        );
      }
    }

    await tx.insert(orderAccess).values({ orderId, tokenHash: hashToken(rawToken), expiresAt: computeAccessExpiry() });

    await emitDomainEvent(tx, {
      aggregateId: orderId,
      eventType: 'order.duplicated',
      payload: {
        sourceOrderId: id,
        sourceOrderNumber: source.orderNumber,
        actorEmail: meta?.actorEmail ?? null,
      },
    });
  });

  return { orderId: createdOrderId, orderNumber, token: rawToken, url: buildConfirmationUrl(rawToken) };
}

// ---------------------------------------------------------------------------
// Admin writes — order level
// ---------------------------------------------------------------------------

export async function updateOrder(
  id: string,
  patch: UpdateOrderInput,
  meta?: { actorEmail?: string },
) {
  const existing = await db.query.orders.findFirst({ where: eq(orders.id, id) });
  if (!existing) throw new NotFoundError('Order');

  await db.update(orders).set({
    ...(patch.customerName !== undefined && { customerName: patch.customerName }),
    ...(patch.customerEmail !== undefined && { customerEmail: patch.customerEmail }),
    ...(patch.customerContact !== undefined && { customerContact: patch.customerContact }),
    ...(patch.clubName !== undefined && { clubName: patch.clubName }),
    ...(patch.orderValueAmount !== undefined && {
      orderValueAmount: patch.orderValueAmount != null ? String(patch.orderValueAmount) : null,
    }),
    ...(patch.orderValueCurrency !== undefined && { orderValueCurrency: patch.orderValueCurrency }),
    ...(patch.invoiceUrl !== undefined && { invoiceUrl: patch.invoiceUrl }),
    ...(patch.expectedShipDate !== undefined && { expectedShipDate: patch.expectedShipDate }),
    ...(patch.deadlineDate !== undefined && { deadlineDate: patch.deadlineDate }),
    ...(patch.generalNotes !== undefined && { generalNotes: patch.generalNotes }),
    ...(patch.internalNotes !== undefined && { internalNotes: patch.internalNotes }),
    ...(patch.shippingMode !== undefined && { shippingMode: patch.shippingMode }),
    ...(patch.shippingAddress !== undefined && { shippingAddress: patch.shippingAddress }),
    ...(patch.status !== undefined && { status: patch.status }),
    updatedAt: new Date(),
  }).where(eq(orders.id, id));

  await recordAuditEvent({
    aggregateId: id,
    eventType: 'order.updated',
    payload: { fields: Object.keys(patch), actorEmail: meta?.actorEmail ?? null },
  });
}

export async function deleteOrder(id: string) {
  const existing = await db.query.orders.findFirst({ where: eq(orders.id, id) });
  if (!existing) throw new NotFoundError('Order');
  if (existing.status !== 'draft') {
    throw new ConflictError('Only draft orders can be deleted');
  }
  await db.delete(orders).where(eq(orders.id, id));
}

// ---------------------------------------------------------------------------
// Admin writes — garments
// ---------------------------------------------------------------------------

export async function addGarment(orderId: string, data: AddGarmentInput) {
  const [{ maxSort }] = await db
    .select({ maxSort: sql<number>`coalesce(max(${garments.sortOrder}), -1)` })
    .from(garments)
    .where(eq(garments.orderId, orderId));

  const [garment] = await db
    .insert(garments)
    .values({
      orderId,
      name: data.name,
      fabrics: data.fabrics ?? [],
      notes: data.notes ?? null,
      sortOrder: data.sortOrder ?? (Number(maxSort) + 1),
    })
    .returning();

  return garment;
}

export async function updateGarment(id: string, data: UpdateGarmentInput) {
  const existing = await db.query.garments.findFirst({ where: eq(garments.id, id) });
  if (!existing) throw new NotFoundError('Garment');

  await db.update(garments).set({
    ...(data.name !== undefined && { name: data.name }),
    ...(data.fabrics !== undefined && { fabrics: data.fabrics }),
    ...(data.notes !== undefined && { notes: data.notes }),
    ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
    updatedAt: new Date(),
  }).where(eq(garments.id, id));
}

export async function deleteGarment(id: string) {
  const existing = await db.query.garments.findFirst({ where: eq(garments.id, id) });
  if (!existing) throw new NotFoundError('Garment');
  await db.delete(garments).where(eq(garments.id, id));
}

// ---------------------------------------------------------------------------
// Admin writes — sizing rows (bulk replace)
// ---------------------------------------------------------------------------

export async function upsertSizingRows(garmentId: string, rows: UpsertSizingInput) {
  await db.transaction(async (tx) => {
    await tx.delete(garmentSizing).where(eq(garmentSizing.garmentId, garmentId));
    if (rows.length > 0) {
      await tx.insert(garmentSizing).values(
        rows.map((row, i) => ({
          garmentId,
          size: row.size ?? null,
          playerName: row.playerName ?? null,
          playerNumber: row.playerNumber ?? null,
          notes: row.notes ?? null,
          sortOrder: row.sortOrder ?? i,
        })),
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Admin writes — mock-up images
// ---------------------------------------------------------------------------

export async function addMockupImage(
  garmentId: string,
  data: { storageKey: string; caption?: string | null },
) {
  const [{ maxSort }] = await db
    .select({ maxSort: sql<number>`coalesce(max(${mockupImages.sortOrder}), -1)` })
    .from(mockupImages)
    .where(eq(mockupImages.garmentId, garmentId));

  const [image] = await db
    .insert(mockupImages)
    .values({ garmentId, storageKey: data.storageKey, caption: data.caption ?? null, sortOrder: Number(maxSort) + 1 })
    .returning();

  return image;
}

// ---------------------------------------------------------------------------
// Admin writes — garment ↔ size-chart links (bulk replace)
// ---------------------------------------------------------------------------

export async function updateGarmentSizeChartLinks(
  garmentId: string,
  sizeChartIds: string[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(garmentSizeChartLinks)
      .where(eq(garmentSizeChartLinks.garmentId, garmentId));
    if (sizeChartIds.length > 0) {
      await tx
        .insert(garmentSizeChartLinks)
        .values(sizeChartIds.map((sizeChartId) => ({ garmentId, sizeChartId })));
    }
  });
}

export async function deleteMockupImage(id: string): Promise<{ storageKey: string }> {
  const existing = await db.query.mockupImages.findFirst({ where: eq(mockupImages.id, id) });
  if (!existing) throw new NotFoundError('Image');
  await db.delete(mockupImages).where(eq(mockupImages.id, id));
  return { storageKey: existing.storageKey };
}

// ---------------------------------------------------------------------------
// Admin writes — access token
// ---------------------------------------------------------------------------

export async function generateAccessToken(
  orderId: string,
  meta?: { actorEmail?: string },
): Promise<{ token: string; url: string }> {
  const existing = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!existing) throw new NotFoundError('Order');
  if (existing.status === 'cancelled') {
    throw new ConflictError('Cannot generate a link for a cancelled order');
  }

  const [{ total: garmentCount }] = await db
    .select({ total: count() })
    .from(garments)
    .where(eq(garments.orderId, orderId));
  if (garmentCount === 0) {
    throw new ConflictError('Add at least one garment before generating a customer link');
  }

  const rawToken = generateToken();

  await db.transaction(async (tx) => {
    // Carry the per-order access code (if enabled) onto the replacement link,
    // so regenerating the URL doesn't force staff to relay a new code.
    const previous = await tx.query.orderAccess.findFirst({
      where: and(eq(orderAccess.orderId, orderId), isNull(orderAccess.revokedAt)),
      orderBy: [desc(orderAccess.createdAt)],
    });

    // Revoke any existing active tokens for this order.
    await tx
      .update(orderAccess)
      .set({ revokedAt: new Date() })
      .where(and(eq(orderAccess.orderId, orderId), isNull(orderAccess.revokedAt)));

    await tx.insert(orderAccess).values({
      orderId,
      tokenHash: hashToken(rawToken),
      expiresAt: computeAccessExpiry(),
      accessCodeHash: previous?.accessCodeHash ?? null,
    });

    // Advance status from draft → sent on first link generation.
    await tx
      .update(orders)
      .set({ status: 'sent', updatedAt: new Date() })
      .where(and(eq(orders.id, orderId), eq(orders.status, 'draft')));

    await emitDomainEvent(tx, {
      aggregateId: orderId,
      eventType: 'token.generated',
      payload: { actorEmail: meta?.actorEmail ?? null },
    });
  });

  return { token: rawToken, url: buildConfirmationUrl(rawToken) };
}

export async function revokeAccessToken(
  orderId: string,
  meta?: { actorEmail?: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(orderAccess)
      .set({ revokedAt: new Date() })
      .where(and(eq(orderAccess.orderId, orderId), isNull(orderAccess.revokedAt)));

    await emitDomainEvent(tx, {
      aggregateId: orderId,
      eventType: 'token.revoked',
      payload: { actorEmail: meta?.actorEmail ?? null },
    });
  });
}

/**
 * Enable (or rotate) the optional per-order access code on the active
 * customer link. Returns the raw code ONCE — only the bcrypt hash is stored.
 * Staff relay the code out-of-band (phone/text); it is never emailed.
 */
export async function setOrderAccessCode(
  orderId: string,
  meta?: { actorEmail?: string },
): Promise<{ code: string }> {
  const access = await db.query.orderAccess.findFirst({
    where: and(eq(orderAccess.orderId, orderId), isNull(orderAccess.revokedAt)),
    orderBy: [desc(orderAccess.createdAt)],
  });
  if (!access) {
    throw new ConflictError('Generate a customer link before enabling an access code');
  }

  const code = generateAccessCode();
  const accessCodeHash = await hashAccessCode(code);

  await db.transaction(async (tx) => {
    await tx
      .update(orderAccess)
      .set({ accessCodeHash })
      .where(eq(orderAccess.id, access.id));

    await emitDomainEvent(tx, {
      aggregateId: orderId,
      eventType: 'access_code.enabled',
      payload: { actorEmail: meta?.actorEmail ?? null },
    });
  });

  return { code };
}

/** Remove the per-order access code — the link alone opens the order again. */
export async function clearOrderAccessCode(
  orderId: string,
  meta?: { actorEmail?: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(orderAccess)
      .set({ accessCodeHash: null })
      .where(
        and(
          eq(orderAccess.orderId, orderId),
          isNull(orderAccess.revokedAt),
          isNotNull(orderAccess.accessCodeHash),
        ),
      )
      .returning({ id: orderAccess.id });

    // Idempotent: no event when there was no code to clear.
    if (updated.length === 0) return;

    await emitDomainEvent(tx, {
      aggregateId: orderId,
      eventType: 'access_code.disabled',
      payload: { actorEmail: meta?.actorEmail ?? null },
    });
  });
}

/**
 * Mark a dead deal as cancelled and revoke its customer link. Terminal —
 * there is no un-cancel; a revived deal should be duplicated (#8) into a
 * fresh draft instead.
 */
export async function cancelOrder(
  id: string,
  meta?: { actorEmail?: string },
): Promise<void> {
  const existing = await db.query.orders.findFirst({ where: eq(orders.id, id) });
  if (!existing) throw new NotFoundError('Order');
  if (existing.status === 'confirmed') {
    throw new ConflictError('Cannot cancel a confirmed order');
  }
  if (existing.status === 'cancelled') {
    throw new ConflictError('Order is already cancelled');
  }

  await db.transaction(async (tx) => {
    // Guard against a concurrent confirm/re-cancel racing this update — mirrors
    // the confirm-race guard in customer-service.ts's confirmOrder().
    const updated = await tx
      .update(orders)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(and(eq(orders.id, id), ne(orders.status, 'confirmed'), ne(orders.status, 'cancelled')))
      .returning({ id: orders.id });

    if (updated.length === 0) {
      throw new ConflictError('Order cannot be cancelled in its current state');
    }

    await tx
      .update(orderAccess)
      .set({ revokedAt: new Date() })
      .where(and(eq(orderAccess.orderId, id), isNull(orderAccess.revokedAt)));

    await emitDomainEvent(tx, {
      aggregateId: id,
      eventType: 'order.cancelled',
      payload: { actorEmail: meta?.actorEmail ?? null },
    });
  });
}

// ---------------------------------------------------------------------------
// Customer read (token-gated)
// ---------------------------------------------------------------------------

export async function getOrderByToken(rawToken: string) {
  const access = await db.query.orderAccess.findFirst({
    where: eq(orderAccess.tokenHash, hashToken(rawToken)),
  });
  if (!access || access.revokedAt) return null;
  if (access.expiresAt && access.expiresAt.getTime() < Date.now()) return null;

  return db.query.orders.findFirst({ where: eq(orders.id, access.orderId) });
}
