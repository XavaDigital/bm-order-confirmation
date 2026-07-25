import { NextResponse } from 'next/server';
import { generateAccessToken, revokeAccessToken } from '@/server/orders/service';
import { defineRoute } from '@/lib/route-handler';

/** Generate (or regenerate) the customer magic link for this order. */
export const POST = defineRoute<{ id: string }>({
  auth: 'staff',
  tag: 'orders/[id]/token POST',
  handler: async ({ params, session }) => {
    const result = await generateAccessToken(params.id, { actorEmail: session!.email });
    return NextResponse.json(result, { status: 201 });
  },
});

/** Revoke the current customer magic link. */
export const DELETE = defineRoute<{ id: string }>({
  auth: 'staff',
  tag: 'orders/[id]/token DELETE',
  handler: async ({ params, session }) => {
    await revokeAccessToken(params.id, { actorEmail: session!.email });
    return NextResponse.json({ ok: true });
  },
});
