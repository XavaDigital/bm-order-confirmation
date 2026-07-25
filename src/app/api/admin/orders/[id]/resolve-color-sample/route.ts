import { NextResponse } from 'next/server';
import { resolveColorSampleRequest } from '@/server/orders/service';
import { defineRoute } from '@/lib/route-handler';

/** Clear the "hold production" colour-sample flag once it's been arranged with the customer. */
export const POST = defineRoute<{ id: string }>({
  auth: 'staff',
  tag: 'orders/[id]/resolve-color-sample POST',
  handler: async ({ params, session }) => {
    await resolveColorSampleRequest(params.id, { actorEmail: session!.email });
    return NextResponse.json({ ok: true });
  },
});
