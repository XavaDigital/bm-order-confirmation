import { NextResponse } from 'next/server';
import { cancelOrder } from '@/server/orders/service';
import { defineRoute } from '@/lib/route-handler';

/** Mark a dead deal as cancelled and revoke its customer link. */
export const POST = defineRoute<{ id: string }>({
  auth: 'staff',
  tag: 'orders/[id]/cancel POST',
  handler: async ({ params, session }) => {
    await cancelOrder(params.id, { actorEmail: session!.email });
    return NextResponse.json({ ok: true });
  },
});
