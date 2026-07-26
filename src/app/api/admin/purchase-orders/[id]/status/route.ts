import { NextResponse } from 'next/server';
import { defineRoute } from '@/lib/route-handler';
import { updatePurchaseOrderStatus } from '@/server/purchase-orders/service';
import { updatePoStatusSchema } from '@/server/purchase-orders/contract';

export const POST = defineRoute<{ id: string }, typeof updatePoStatusSchema._type>({
  auth: 'staff',
  tag: 'purchase-orders [id]/status POST',
  schema: updatePoStatusSchema,
  handler: async ({ params, body, session }) => {
    const po = await updatePurchaseOrderStatus(params.id, body.status, {
      actorEmail: session!.email,
    });
    return NextResponse.json(po);
  },
});
