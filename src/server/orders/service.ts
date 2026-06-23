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
import { eq } from 'drizzle-orm';
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
import type { CreateOrderInput } from './contract';

function generateOrderNumber(): string {
  // Short, human-friendly, collision-resistant. Refine when the platform owns numbering.
  return `OC-${randomBytes(4).toString('hex').toUpperCase()}`;
}

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
        orderValueAmount: input.orderValue
          ? input.orderValue.amount.toFixed(2)
          : null,
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
        .values({
          orderId,
          name: g.name,
          fabrics: g.fabrics ?? [],
          notes: g.notes,
          sortOrder: i,
        })
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
          g.sizeChartIds.map((sizeChartId) => ({
            garmentId: garment.id,
            sizeChartId,
          })),
        );
      }
    }

    // Magic-link access. Optional confirmation code is wired later (default off).
    await tx.insert(orderAccess).values({
      orderId,
      tokenHash: hashToken(rawToken),
      accessCodeHash: input.requireAccessCode ? null : null, // TODO: hash a generated code when enabled
    });
  });

  return {
    orderId: createdOrderId,
    orderNumber,
    token: rawToken,
    url: buildConfirmationUrl(rawToken),
  };
}

export async function getOrderById(id: string) {
  return db.query.orders.findFirst({ where: eq(orders.id, id) });
}

export async function listOrders() {
  return db.query.orders.findMany({
    columns: {
      id: true,
      orderNumber: true,
      customerName: true,
      clubName: true,
      status: true,
      createdAt: true,
      confirmedAt: true,
    },
    orderBy: (o, { desc }) => [desc(o.createdAt)],
    limit: 100,
  });
}

/** Look up an order by raw magic-link token (for the customer page). */
export async function getOrderByToken(rawToken: string) {
  const access = await db.query.orderAccess.findFirst({
    where: eq(orderAccess.tokenHash, hashToken(rawToken)),
  });
  if (!access || access.revokedAt) return null;
  if (access.expiresAt && access.expiresAt.getTime() < Date.now()) return null;

  return db.query.orders.findFirst({ where: eq(orders.id, access.orderId) });
}
