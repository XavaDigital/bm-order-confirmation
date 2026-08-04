import { NextResponse } from 'next/server';
import { createOrder, getOrderByExternalRef } from '@/server/orders/service';
import { createOrderSchema } from '@/server/orders/contract';
import { defineRoute } from '@/lib/route-handler';
import { resolveActingUserLabel } from '@/server/identity/client';
import { env } from '@/lib/env';

/**
 * Inbound capability surface (fleet convention — see bm-designflow's
 * capability.controller): the hub / Email Flow creates a confirmation order
 * here. Guarded by the per-app INBOUND_CAPABILITY_SECRET bearer + a required
 * X-Acting-User header for attribution. Idempotent on `externalRef` (the
 * caller's own id for the order) — a replay returns the existing order.
 *
 * Response shape (pinned with salesflow, fleet thread 2026-08-01): the relay
 * reads `id` off the 2xx and registers `url` as the order_platform deep link.
 * `id` = our order uuid; `url` = the ADMIN deep link. The customer magic-link
 * (raw token + /o/ URL) is deliberately NOT returned on this surface — the
 * hub would file it as the CRM deep link and every CRM reader would hold the
 * customer's secret URL. Staff send the link from this app instead. (The
 * x-api-key POST /api/orders platform surface still returns it; that contract
 * is unchanged.)
 */
function orderResponse(orderId: string, orderNumber: string, created: boolean) {
  return {
    id: orderId,
    orderId,
    orderNumber,
    url: `${env.APP_BASE_URL}/admin/orders/${orderId}`,
    created,
    // Legacy field predating `created`; kept so older readers keep working.
    existing: !created,
  };
}

export const POST = defineRoute<Record<string, never>, typeof createOrderSchema._type>({
  auth: 'capability',
  tag: 'capability/orders POST',
  schema: createOrderSchema,
  handler: async ({ body, actingUser }) => {
    // Idempotency: replays with the same externalRef return the existing order
    // (200). The original magic-link token cannot be re-derived (stored hashed).
    if (body.externalRef) {
      const existing = await getOrderByExternalRef(body.externalRef);
      if (existing) {
        return NextResponse.json(
          orderResponse(existing.id, existing.orderNumber, false),
          { status: 200 },
        );
      }
    }

    // The composer's note becomes an attributed order note (David,
    // 2026-08-04) — resolve the actor's name for its byline. createdBy stays
    // unset: it is a staff_users uuid, and the acting user is a hub identity.
    const result = await createOrder({ ...body, source: 'platform' }, undefined, {
      noteAuthorLabel: body.notes ? await resolveActingUserLabel(actingUser!) : undefined,
    });
    return NextResponse.json(
      orderResponse(result.orderId, result.orderNumber, true),
      { status: 201 },
    );
  },
});
