import { NextResponse } from 'next/server';
import { defineRoute } from '@/lib/route-handler';
import { getPurchaseOrder, updatePurchaseOrder } from '@/server/purchase-orders/service';
import { updatePurchaseOrderSchema } from '@/server/purchase-orders/contract';

export const GET = defineRoute<{ id: string }>({
  auth: 'staff',
  tag: 'purchase-orders [id] GET',
  handler: async ({ params }) => NextResponse.json(await getPurchaseOrder(params.id)),
});

export const PATCH = defineRoute<{ id: string }, typeof updatePurchaseOrderSchema._type>({
  auth: 'staff',
  tag: 'purchase-orders [id] PATCH',
  schema: updatePurchaseOrderSchema,
  handler: async ({ params, body, session }) => {
    const po = await updatePurchaseOrder(params.id, body, { actorEmail: session!.email });
    return NextResponse.json(po);
  },
});
