import { NextResponse } from 'next/server';
import { createOrder, getOrderByExternalRef } from '@/server/orders/service';
import { createOrderSchema } from '@/server/orders/contract';
import { defineRoute } from '@/lib/route-handler';

/**
 * Inbound capability surface (fleet convention — see bm-designflow's
 * capability.controller): the hub / Email Flow creates a confirmation order
 * here. Guarded by the per-app INBOUND_CAPABILITY_SECRET bearer + a required
 * X-Acting-User header for attribution. Idempotent on `externalRef` (the
 * caller's own id for the order) — a replay returns the existing order.
 */
export const POST = defineRoute<Record<string, never>, typeof createOrderSchema._type>({
  auth: 'capability',
  tag: 'capability/orders POST',
  schema: createOrderSchema,
  handler: async ({ body }) => {
    // Idempotency: replays with the same externalRef return the existing order
    // (200). The original magic-link token cannot be re-derived (stored hashed).
    if (body.externalRef) {
      const existing = await getOrderByExternalRef(body.externalRef);
      if (existing) {
        return NextResponse.json(
          { orderId: existing.id, orderNumber: existing.orderNumber, existing: true },
          { status: 200 },
        );
      }
    }

    const result = await createOrder({ ...body, source: 'platform' });
    return NextResponse.json(result, { status: 201 });
  },
});
