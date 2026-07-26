import { NextResponse } from 'next/server';
import { attachPurchaseOrders, detachPurchaseOrder } from '@/server/shipments/service';
import {
  attachPurchaseOrdersSchema,
  detachPurchaseOrderSchema,
} from '@/server/shipments/contract';
import { defineRoute } from '@/lib/route-handler';

export const POST = defineRoute<{ id: string }, typeof attachPurchaseOrdersSchema._type>({
  auth: 'staff',
  tag: 'shipments/[id]/purchase-orders POST',
  schema: attachPurchaseOrdersSchema,
  handler: async ({ params, body, session }) =>
    NextResponse.json(
      await attachPurchaseOrders(params.id, body.purchaseOrderIds, {
        actorStaffUserId: session!.userId,
        actorEmail: session!.email,
      }),
    ),
});

// DELETE with a JSON body ({ purchaseOrderId }) — the junction row has a
// composite key, so the PO id travels in the body rather than the path.
export const DELETE = defineRoute<{ id: string }, typeof detachPurchaseOrderSchema._type>({
  auth: 'staff',
  tag: 'shipments/[id]/purchase-orders DELETE',
  schema: detachPurchaseOrderSchema,
  handler: async ({ params, body, session }) =>
    NextResponse.json(
      await detachPurchaseOrder(params.id, body.purchaseOrderId, {
        actorStaffUserId: session!.userId,
        actorEmail: session!.email,
      }),
    ),
});
