import { NextResponse } from 'next/server';
import { duplicateOrder } from '@/server/orders/service';
import { defineRoute } from '@/lib/route-handler';

export const POST = defineRoute<{ id: string }>({
  auth: 'staff',
  tag: 'orders/[id]/duplicate POST',
  handler: async ({ params, session }) => {
    const result = await duplicateOrder(params.id, session!.userId, { actorEmail: session!.email });
    return NextResponse.json(result, { status: 201 });
  },
});
