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
  garmentTypes,
  orderAccess,
  orderAssets,
  domainEvents,
} from '@/db/schema';
import type { Transaction } from '@/db';
import type { GarmentTypeOption } from '@/db/schema';
import { generateToken, buildConfirmationUrl } from '@/lib/tokens';
import { isUniqueViolation } from '@/lib/db-errors';
import { pickDefined } from '@/lib/patch';
import { insertToken, mintToken, resolveActiveToken, revokeActiveTokens } from '@/server/access/tokens';
import { generateAccessCode, hashAccessCode } from '@/lib/access-code';
import { STALE_THRESHOLD_DAYS } from '@/lib/config';
import { env } from '@/lib/env';
import { emitOrderEvent, recordAuditEvent } from '@/server/events/outbox';
import { canTransitionOrder, explainOrderTransition } from './status-machine';
import type { OrderStatus } from '@/lib/status';
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

/**
 * Run `fn` with a freshly generated order number, retrying on an order-number
 * unique violation. 32 bits of randomness makes collisions rare but
 * inevitable at scale (~1.2% odds of one by 10k orders) — without the retry a
 * collision surfaces as an unhandled 500 on a create path.
 */
async function withOrderNumberRetry<T>(
  fn: (orderNumber: string) => Promise<T>,
  attempts = 3,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(generateOrderNumber());
    } catch (err) {
      if (attempt < attempts && isUniqueViolation(err, 'orders_order_number_unique')) continue;
      throw err;
    }
  }
}

async function loadOrderOrThrow(id: string) {
  const order = await db.query.orders.findFirst({ where: eq(orders.id, id) });
  if (!order) throw new NotFoundError('Order');
  return order;
}

async function loadGarmentOrThrow(id: string) {
  const garment = await db.query.garments.findFirst({ where: eq(garments.id, id) });
  if (!garment) throw new NotFoundError('Garment');
  return garment;
}

/** Next free sortOrder within a scope (0 for the first row). */
async function nextSortOrder(
  executor: Transaction | typeof db,
  table: typeof garments | typeof mockupImages,
  where: ReturnType<typeof eq>,
): Promise<number> {
  const [{ maxSort }] = await executor
    .select({ maxSort: sql<number>`coalesce(max(${table.sortOrder}), -1)` })
    .from(table)
    .where(where);
  return Number(maxSort) + 1;
}

/**
 * Keep only values whose label matches one of the garment's defined sizing
 * columns, and drop empties. The definitions are the allowlist, so a stale or
 * hostile client can't write arbitrary keys into the jsonb; returns null when
 * nothing survives, matching the "null when empty" convention used by
 * garments.selectedOptions.
 */
export function pickCustomValues(
  values: Record<string, string> | null | undefined,
  columns: GarmentTypeOption[],
): Record<string, string> | null {
  if (!values || columns.length === 0) return null;
  const allowed = new Set(columns.map((c) => c.label));
  const out: Record<string, string> = {};
  for (const [label, value] of Object.entries(values)) {
    if (allowed.has(label) && value !== '') out[label] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Everything hanging off one garment row — shared by create and duplicate. */
type GarmentTreeInput = {
  name: string;
  fabrics: string[];
  notes?: string | null;
  sortOrder: number;
  garmentTypeId?: string | null;
  selectedOptions?: Record<string, string> | null;
  selectedFabrics?: Record<string, string> | null;
  sizingColumns?: GarmentTypeOption[];
  sizing: {
    size?: string | null;
    playerName?: string | null;
    playerNumber?: string | null;
    /** Omitted means one garment — defaulted at the insert, not here. */
    quantity?: number | null;
    notes?: string | null;
    customValues?: Record<string, string> | null;
    sortOrder?: number;
  }[];
  mockupStorageKeys?: string[];
  chartIds: string[];
};

/** Insert a garment plus its sizing rows, mock-up refs, and chart links. */
async function insertGarmentTree(
  tx: Transaction,
  orderId: string,
  g: GarmentTreeInput,
): Promise<string> {
  const [garment] = await tx
    .insert(garments)
    .values({
      orderId,
      name: g.name,
      fabrics: g.fabrics,
      notes: g.notes ?? null,
      sortOrder: g.sortOrder,
      garmentTypeId: g.garmentTypeId ?? null,
      selectedOptions:
        g.selectedOptions && Object.keys(g.selectedOptions).length > 0 ? g.selectedOptions : null,
      selectedFabrics:
        g.selectedFabrics && Object.keys(g.selectedFabrics).length > 0 ? g.selectedFabrics : null,
      sizingColumns: g.sizingColumns ?? [],
    })
    .returning({ id: garments.id });

  if (g.sizing.length) {
    const columns = g.sizingColumns ?? [];
    await tx.insert(garmentSizing).values(
      g.sizing.map((row, j) => ({
        garmentId: garment.id,
        size: row.size ?? null,
        playerName: row.playerName ?? null,
        playerNumber: row.playerNumber ?? null,
        // The column is NOT NULL DEFAULT 1, so a row that omits it means one
        // garment — the same thing a row meant before quantity existed.
        quantity: row.quantity ?? 1,
        notes: row.notes ?? null,
        customValues: pickCustomValues(row.customValues, columns),
        sortOrder: row.sortOrder ?? j,
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

  if (g.chartIds.length > 0) {
    await tx.insert(garmentSizeChartLinks).values(
      g.chartIds.map((sizeChartId) => ({ garmentId: garment.id, sizeChartId })),
    );
  }

  return garment.id;
}

/**
 * Resolve a garment-type preset for garment creation: the type's linked size
 * charts (to auto-attach) and default option values ({label: value}).
 */
async function resolveGarmentTypePreset(
  tx: Transaction | typeof db,
  garmentTypeId: string,
): Promise<{
  chartIds: string[];
  optionDefaults: Record<string, string>;
  sizingColumns: GarmentTypeOption[];
}> {
  const type = await tx.query.garmentTypes.findFirst({
    where: eq(garmentTypes.id, garmentTypeId),
    with: { sizeChartLinks: { columns: { sizeChartId: true } } },
  });
  if (!type) throw new NotFoundError('Garment type');

  const optionDefaults: Record<string, string> = {};
  for (const opt of type.orderOptions ?? []) {
    if (opt.type === 'select' && opt.defaultOption) optionDefaults[opt.label] = opt.defaultOption;
    if (opt.type === 'text' && opt.defaultValue) optionDefaults[opt.label] = opt.defaultValue;
  }
  return {
    chartIds: type.sizeChartLinks.map((l) => l.sizeChartId),
    optionDefaults,
    // Copied onto the garment; the garment owns its copy from then on, so
    // editing the type never rewrites live orders.
    sizingColumns: type.sizingColumns ?? [],
  };
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
  const rawToken = generateToken();
  let createdOrderId = '';

  const orderNumber = await withOrderNumberRetry(async (orderNumber) => {
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
        hubCustomerId: input.hubCustomerId ?? null,
        hubCustomerName: input.hubCustomerName ?? null,
      })
      .returning({ id: orders.id });

    const orderId = order.id;
    createdOrderId = orderId;

    for (const [i, g] of input.garments.entries()) {
      // A garment-type preset auto-attaches the type's size charts and
      // defaults option values for anything the caller didn't specify.
      const preset = g.garmentTypeId
        ? await resolveGarmentTypePreset(tx, g.garmentTypeId)
        : null;
      const selectedOptions = preset
        ? { ...preset.optionDefaults, ...(g.selectedOptions ?? {}) }
        : (g.selectedOptions ?? null);
      const chartIds = [...new Set([...(g.sizeChartIds ?? []), ...(preset?.chartIds ?? [])])];

      await insertGarmentTree(tx, orderId, {
        name: g.name,
        fabrics: g.fabrics ?? [],
        notes: g.notes,
        sortOrder: i,
        garmentTypeId: g.garmentTypeId,
        selectedOptions,
        selectedFabrics: g.selectedFabrics,
        sizingColumns: g.sizingColumns ?? preset?.sizingColumns ?? [],
        sizing: g.sizing ?? [],
        mockupStorageKeys: g.mockupStorageKeys,
        chartIds,
      });
    }

    await insertToken(tx, orderAccess, rawToken, { orderId });
  });
    return orderNumber;
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
        colorSampleRequestedAt: true,
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
      assets: {
        orderBy: (a, { asc }) => [asc(a.sortOrder), asc(a.createdAt)],
        with: { garment: { columns: { id: true, name: true } } },
      },
      sourceOrder: { columns: { id: true, orderNumber: true } },
    },
  });

  if (!order) return null;

  const currentAccess = await db.query.orderAccess.findFirst({
    where: and(eq(orderAccess.orderId, id), isNull(orderAccess.revokedAt)),
    orderBy: [desc(orderAccess.createdAt)],
  });

  return { ...order, currentAccess: currentAccess ?? null };
}

/** Lookup for the capability surface's externalRef idempotency check. */
export async function getOrderByExternalRef(externalRef: string) {
  return db.query.orders.findFirst({ where: eq(orders.externalRef, externalRef) });
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
  meta?: { actorEmail?: string; reprint?: boolean; reprintReason?: string | null },
): Promise<CreateOrderResult> {
  const source = await getOrderAdmin(id);
  if (!source) throw new NotFoundError('Order');
  const isReprint = meta?.reprint === true;

  const rawToken = generateToken();
  let createdOrderId = '';

  const orderNumber = await withOrderNumberRetry(async (orderNumber) => {
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
        // Same customer, same hub association
        hubCustomerId: source.hubCustomerId ?? null,
        hubCustomerName: source.hubCustomerName ?? null,
        // A reprint records what it reprints; a plain duplicate does not, so
        // "reprint of" never appears on an unrelated copy.
        sourceOrderId: isReprint ? source.id : null,
        reprintReason: isReprint ? (meta?.reprintReason ?? null) : null,
      })
      .returning({ id: orders.id });

    const orderId = order.id;
    createdOrderId = orderId;

    for (const g of source.garments) {
      // No mockupStorageKeys: image storage keys are namespaced per-order (see
      // the doc comment above) — the duplicate starts with no mock-ups.
      await insertGarmentTree(tx, orderId, {
        name: g.name,
        fabrics: Array.isArray(g.fabrics) ? g.fabrics : [],
        notes: g.notes,
        sortOrder: g.sortOrder,
        garmentTypeId: g.garmentTypeId,
        selectedOptions: g.selectedOptions,
        selectedFabrics: g.selectedFabrics,
        sizingColumns: g.sizingColumns ?? [],
        sizing: g.sizing,
        chartIds: g.sizeChartLinks.map((l) => l.sizeChartId),
      });
    }

    // Design/font links carry forward (unlike mock-ups, whose storage keys are
    // per-order). For a reprint this is the point: same artwork, same fonts.
    if (source.assets.length > 0) {
      await tx.insert(orderAssets).values(
        source.assets.map((asset) => ({
          orderId,
          // Garment ids belong to the SOURCE order's garments, so a tagged
          // asset becomes order-wide on the copy rather than dangling.
          garmentId: null,
          kind: asset.kind,
          name: asset.name,
          url: asset.url,
          notes: asset.notes,
          includeOnPo: asset.includeOnPo,
          sortOrder: asset.sortOrder,
          createdBy: createdBy ?? null,
        })),
      );
    }

    await insertToken(tx, orderAccess, rawToken, { orderId });

    await emitOrderEvent(tx, {
      aggregateId: orderId,
      eventType: isReprint ? 'order.reprint_created' : 'order.duplicated',
      payload: {
        sourceOrderId: id,
        sourceOrderNumber: source.orderNumber,
        ...(isReprint ? { reprintReason: meta?.reprintReason ?? null } : {}),
        actorEmail: meta?.actorEmail ?? null,
      },
    });
  });
    return orderNumber;
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
  const existing = await loadOrderOrThrow(id);

  // A status arriving through the generic PATCH used to be written straight
  // through, so a confirmed order could be silently reverted to draft with the
  // customer's signature still on file and no event emitted. Validate it like
  // any other transition.
  const statusChanged = patch.status !== undefined && patch.status !== existing.status;
  if (statusChanged) {
    const to = patch.status as OrderStatus;
    if (!canTransitionOrder(existing.status, to)) {
      throw new ConflictError(
        explainOrderTransition(existing.status, to) ??
          `Cannot move an order from ${existing.status} to ${to}`,
      );
    }
  }

  const { orderValueAmount, ...rest } = patch;
  await db.transaction(async (tx) => {
    await tx.update(orders).set({
      ...pickDefined(rest),
      ...(orderValueAmount !== undefined && {
        orderValueAmount: orderValueAmount != null ? String(orderValueAmount) : null,
      }),
      updatedAt: new Date(),
    }).where(eq(orders.id, id));

    await recordAuditEvent(
      {
        aggregateId: id,
        eventType: 'order.updated',
        payload: { fields: Object.keys(patch) },
        actorEmail: meta?.actorEmail ?? null,
      },
      tx,
    );

    // A status change is history in its own right — the timeline showed only
    // "order details updated" before, which hid the most consequential edit a
    // PATCH can make.
    if (statusChanged) {
      await recordAuditEvent(
        {
          aggregateId: id,
          eventType: 'order.status_changed',
          payload: { from: existing.status, to: patch.status },
          actorEmail: meta?.actorEmail ?? null,
        },
        tx,
      );
    }
  });
}

export async function deleteOrder(id: string, meta?: { actorEmail?: string }) {
  const existing = await loadOrderOrThrow(id);
  if (existing.status !== 'draft') {
    throw new ConflictError('Only draft orders can be deleted');
  }
  await db.delete(orders).where(eq(orders.id, id));

  await recordAuditEvent({
    aggregateId: id,
    eventType: 'order.deleted',
    payload: { orderNumber: existing.orderNumber },
    actorEmail: meta?.actorEmail ?? null,
  });
}

// ---------------------------------------------------------------------------
// Admin writes — garments
// ---------------------------------------------------------------------------

export async function addGarment(
  orderId: string,
  data: AddGarmentInput,
  meta?: { actorEmail?: string },
) {
  return db.transaction(async (tx) => {
    const preset = data.garmentTypeId
      ? await resolveGarmentTypePreset(tx, data.garmentTypeId)
      : null;
    const selectedOptions = preset
      ? { ...preset.optionDefaults, ...(data.selectedOptions ?? {}) }
      : (data.selectedOptions ?? null);

    const sortOrder =
      data.sortOrder ?? (await nextSortOrder(tx, garments, eq(garments.orderId, orderId)));

    const garmentId = await insertGarmentTree(tx, orderId, {
      name: data.name,
      fabrics: data.fabrics ?? [],
      notes: data.notes,
      sortOrder,
      garmentTypeId: data.garmentTypeId,
      selectedOptions,
      selectedFabrics: data.selectedFabrics,
      sizingColumns: data.sizingColumns ?? preset?.sizingColumns ?? [],
      sizing: [],
      chartIds: preset?.chartIds ?? [],
    });

    await recordAuditEvent(
      {
        aggregateId: orderId,
        eventType: 'garment.added',
        payload: { garmentId, name: data.name },
        actorEmail: meta?.actorEmail ?? null,
      },
      tx,
    );

    return (await tx.query.garments.findFirst({ where: eq(garments.id, garmentId) }))!;
  });
}

export async function updateGarment(
  id: string,
  data: UpdateGarmentInput,
  meta?: { actorEmail?: string },
) {
  const garment = await loadGarmentOrThrow(id);

  // Clearing the type (garmentTypeId: null) reverts the garment to the
  // free-text workflow — chosen options are cleared too unless the caller
  // explicitly provides a replacement set.
  const clearingType = data.garmentTypeId === null;
  const { selectedOptions, selectedFabrics, sizeChartIds: _ignored, ...rest } = data;
  await db.update(garments).set({
    ...pickDefined(rest),
    ...(selectedOptions !== undefined
      ? { selectedOptions }
      : clearingType
        ? { selectedOptions: null }
        : {}),
    ...(selectedFabrics !== undefined
      ? { selectedFabrics }
      : clearingType
        ? { selectedFabrics: null }
        : {}),
    updatedAt: new Date(),
  }).where(eq(garments.id, id));

  await recordAuditEvent({
    aggregateId: garment.orderId,
    eventType: 'garment.updated',
    payload: { garmentId: id, fields: Object.keys(data) },
    actorEmail: meta?.actorEmail ?? null,
  });
}

export async function deleteGarment(id: string, meta?: { actorEmail?: string }) {
  const garment = await loadGarmentOrThrow(id);
  await db.delete(garments).where(eq(garments.id, id));

  await recordAuditEvent({
    aggregateId: garment.orderId,
    eventType: 'garment.removed',
    payload: { garmentId: id, name: garment.name },
    actorEmail: meta?.actorEmail ?? null,
  });
}

// ---------------------------------------------------------------------------
// Admin writes — sizing rows (bulk replace)
// ---------------------------------------------------------------------------

export async function upsertSizingRows(
  garmentId: string,
  rows: UpsertSizingInput,
  meta?: { actorEmail?: string },
) {
  const garment = await loadGarmentOrThrow(garmentId);

  await db.transaction(async (tx) => {
    // Reconciling upsert — NOT delete-all + reinsert. Row UUIDs are stable
    // identity: roster-member attribution hangs off them, and PO snapshots
    // key their lines on them, so a staff save must never regenerate ids.
    const existing = await tx
      .select({ id: garmentSizing.id })
      .from(garmentSizing)
      .where(eq(garmentSizing.garmentId, garmentId));
    const existingIds = new Set(existing.map((r) => r.id));

    const keptIds = new Set<string>();
    const inserts: (typeof garmentSizing.$inferInsert)[] = [];

    // The garment's own column definitions are the allowlist for customValues.
    const columns = garment.sizingColumns ?? [];

    for (const [i, row] of rows.entries()) {
      const values = {
        size: row.size ?? null,
        playerName: row.playerName ?? null,
        playerNumber: row.playerNumber ?? null,
        quantity: row.quantity ?? 1,
        notes: row.notes ?? null,
        customValues: pickCustomValues(row.customValues, columns),
        sortOrder: row.sortOrder ?? i,
      };
      // An id we don't recognize for THIS garment is untrusted input — insert
      // a fresh row rather than updating across garment boundaries.
      if (row.id && existingIds.has(row.id)) {
        keptIds.add(row.id);
        await tx
          .update(garmentSizing)
          .set({ ...values, updatedAt: new Date() })
          .where(and(eq(garmentSizing.id, row.id), eq(garmentSizing.garmentId, garmentId)));
      } else {
        inserts.push({ garmentId, ...values });
      }
    }

    const staleIds = existing.filter((r) => !keptIds.has(r.id)).map((r) => r.id);
    if (staleIds.length > 0) {
      await tx.delete(garmentSizing).where(inArray(garmentSizing.id, staleIds));
    }
    if (inserts.length > 0) {
      await tx.insert(garmentSizing).values(inserts);
    }

    await recordAuditEvent(
      {
        aggregateId: garment.orderId,
        eventType: 'sizing.updated',
        payload: { garmentId, rowCount: rows.length },
        actorEmail: meta?.actorEmail ?? null,
      },
      tx,
    );
  });

  // The saved rows (with their final ids) — callers feed these back into the
  // editor so a follow-up save updates rather than reinserting.
  return db.query.garmentSizing.findMany({
    where: eq(garmentSizing.garmentId, garmentId),
    orderBy: [asc(garmentSizing.sortOrder)],
  });
}

// ---------------------------------------------------------------------------
// Admin writes — mock-up images
// ---------------------------------------------------------------------------

export async function addMockupImage(
  garmentId: string,
  data: { storageKey: string; thumbnailStorageKey?: string | null; caption?: string | null },
  meta?: { actorEmail?: string },
) {
  const garment = await loadGarmentOrThrow(garmentId);
  const sortOrder = await nextSortOrder(db, mockupImages, eq(mockupImages.garmentId, garmentId));

  const [image] = await db
    .insert(mockupImages)
    .values({
      garmentId,
      storageKey: data.storageKey,
      thumbnailStorageKey: data.thumbnailStorageKey ?? null,
      caption: data.caption ?? null,
      sortOrder,
    })
    .returning();

  await recordAuditEvent({
    aggregateId: garment.orderId,
    eventType: 'mockup.added',
    payload: { garmentId, imageId: image.id },
    actorEmail: meta?.actorEmail ?? null,
  });

  return image;
}

// ---------------------------------------------------------------------------
// Admin writes — garment ↔ size-chart links (bulk replace)
// ---------------------------------------------------------------------------

export async function updateGarmentSizeChartLinks(
  garmentId: string,
  sizeChartIds: string[],
  meta?: { actorEmail?: string },
): Promise<void> {
  const garment = await loadGarmentOrThrow(garmentId);

  await db.transaction(async (tx) => {
    await tx
      .delete(garmentSizeChartLinks)
      .where(eq(garmentSizeChartLinks.garmentId, garmentId));
    if (sizeChartIds.length > 0) {
      await tx
        .insert(garmentSizeChartLinks)
        .values(sizeChartIds.map((sizeChartId) => ({ garmentId, sizeChartId })));
    }

    await recordAuditEvent(
      {
        aggregateId: garment.orderId,
        eventType: 'chart_links.updated',
        payload: { garmentId, chartCount: sizeChartIds.length },
        actorEmail: meta?.actorEmail ?? null,
      },
      tx,
    );
  });
}

export async function deleteMockupImage(
  id: string,
  meta?: { actorEmail?: string },
): Promise<{ storageKey: string; thumbnailStorageKey: string | null }> {
  const existing = await db.query.mockupImages.findFirst({ where: eq(mockupImages.id, id) });
  if (!existing) throw new NotFoundError('Image');
  const garment = await loadGarmentOrThrow(existing.garmentId);
  await db.delete(mockupImages).where(eq(mockupImages.id, id));

  await recordAuditEvent({
    aggregateId: garment.orderId,
    eventType: 'mockup.removed',
    payload: { imageId: id },
    actorEmail: meta?.actorEmail ?? null,
  });

  return { storageKey: existing.storageKey, thumbnailStorageKey: existing.thumbnailStorageKey };
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

    // Revoke any existing active tokens for this order, then mint the new one.
    await mintToken(tx, orderAccess, rawToken, eq(orderAccess.orderId, orderId), {
      orderId,
      accessCodeHash: previous?.accessCodeHash ?? null,
    });

    // Advance status from draft → sent on first link generation.
    await tx
      .update(orders)
      .set({ status: 'sent', updatedAt: new Date() })
      .where(and(eq(orders.id, orderId), eq(orders.status, 'draft')));

    await emitOrderEvent(tx, {
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
    await revokeActiveTokens(tx, orderAccess, eq(orderAccess.orderId, orderId));

    await emitOrderEvent(tx, {
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

    await emitOrderEvent(tx, {
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

    await emitOrderEvent(tx, {
      aggregateId: orderId,
      eventType: 'access_code.disabled',
      payload: { actorEmail: meta?.actorEmail ?? null },
    });
  });
}

// ---------------------------------------------------------------------------
// Admin writes — team roster lock
// ---------------------------------------------------------------------------
// Lives here (not src/server/roster/service.ts) because it writes the `orders`
// row directly, and this module is the only place order rows are mutated.

/** Freeze the team roster so members can no longer submit/change their sizes. */
export async function lockRoster(
  orderId: string,
  meta?: { actorEmail?: string },
): Promise<void> {
  const existing = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!existing) throw new NotFoundError('Order');

  await db.transaction(async (tx) => {
    await tx
      .update(orders)
      .set({ rosterLockedAt: new Date(), updatedAt: new Date() })
      .where(eq(orders.id, orderId));

    await emitOrderEvent(tx, {
      aggregateId: orderId,
      eventType: 'roster.locked',
      payload: { actorEmail: meta?.actorEmail ?? null },
    });
  });
}

/** Reopen the team roster for further member submissions. */
export async function unlockRoster(
  orderId: string,
  meta?: { actorEmail?: string },
): Promise<void> {
  const existing = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!existing) throw new NotFoundError('Order');

  await db.transaction(async (tx) => {
    await tx
      .update(orders)
      .set({ rosterLockedAt: null, updatedAt: new Date() })
      .where(eq(orders.id, orderId));

    await emitOrderEvent(tx, {
      aggregateId: orderId,
      eventType: 'roster.unlocked',
      payload: { actorEmail: meta?.actorEmail ?? null },
    });
  });
}

/** Clear the "hold production" flag once colour matching has been arranged with the customer. */
export async function resolveColorSampleRequest(
  orderId: string,
  meta?: { actorEmail?: string },
): Promise<void> {
  const existing = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!existing) throw new NotFoundError('Order');

  await db.transaction(async (tx) => {
    const updated = await tx
      .update(orders)
      .set({ colorSampleRequestedAt: null, updatedAt: new Date() })
      .where(and(eq(orders.id, orderId), isNotNull(orders.colorSampleRequestedAt)))
      .returning({ id: orders.id });

    // Idempotent: nothing to resolve if it was never requested (or already resolved).
    if (updated.length === 0) return;

    await emitOrderEvent(tx, {
      aggregateId: orderId,
      eventType: 'order.color_sample_resolved',
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

    await revokeActiveTokens(tx, orderAccess, eq(orderAccess.orderId, id));

    await emitOrderEvent(tx, {
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
  const access = await resolveActiveToken(orderAccess, rawToken);
  if (!access) return null;

  return db.query.orders.findFirst({ where: eq(orders.id, access.orderId) });
}
