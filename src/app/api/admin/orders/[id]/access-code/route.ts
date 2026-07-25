import { NextResponse } from 'next/server';
import { setOrderAccessCode, clearOrderAccessCode } from '@/server/orders/service';
import { defineRoute } from '@/lib/route-handler';

/**
 * Enable (or rotate) the per-order access code on the active customer link.
 * The raw code is returned ONCE — staff relay it out-of-band (phone/text).
 */
export const POST = defineRoute<{ id: string }>({
  auth: 'staff',
  tag: 'orders/[id]/access-code POST',
  handler: async ({ params, session }) => {
    const result = await setOrderAccessCode(params.id, { actorEmail: session!.email });
    return NextResponse.json(result, { status: 201 });
  },
});

/** Remove the access code — the link alone opens the order again. */
export const DELETE = defineRoute<{ id: string }>({
  auth: 'staff',
  tag: 'orders/[id]/access-code DELETE',
  handler: async ({ params, session }) => {
    await clearOrderAccessCode(params.id, { actorEmail: session!.email });
    return NextResponse.json({ ok: true });
  },
});
