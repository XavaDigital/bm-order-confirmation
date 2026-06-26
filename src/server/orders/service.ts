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
import { eq, and, isNull, ilike, or, desc, sql, count } from 'drizzle-orm';
import { db } from '@/db';
import {
  orders,
  garments,
  garmentSizing,
  mockupImages,
  garmentSizeChartLinks,
  orderAccess,
} from '@/db/schema';
import { generateToken, hashToken, buildConfirmationUrl } from '@/lib/tokens';
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

    await tx.insert(orderAccess).values({ orderId, tokenHash: hashToken(rawToken) });
  });

  return { orderId: createdOrderId, orderNumber, token: rawToken, url: buildConfirmationUrl(rawToken) };
}

// ---------------------------------------------------------------------------
// Admin reads
// ---------------------------------------------------------------------------

export async function listOrders(opts?: {
  status?: string;
  search?: string;
  limit?: number;
  offset?: number;
}) {
  const limit = opts?.limit ?? 100;
  const offset = opts?.offset ?? 0;

  const where = and(
    opts?.status ? eq(orders.status, opts.status as never) : undefined,
    opts?.search
      ? or(
          ilike(orders.customerName, `%${opts.search}%`),
          ilike(orders.orderNumber, `%${opts.search}%`),
          ilike(orders.clubName, `%${opts.search}%`),
        )
      : undefined,
  );

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
      orderBy: [desc(orders.createdAt)],
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
  const rawToken = generateToken();

  await db.transaction(async (tx) => {
    // Revoke any existing active tokens for this order.
    await tx
      .update(orderAccess)
      .set({ revokedAt: new Date() })
      .where(and(eq(orderAccess.orderId, orderId), isNull(orderAccess.revokedAt)));

    await tx.insert(orderAccess).values({ orderId, tokenHash: hashToken(rawToken) });

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
