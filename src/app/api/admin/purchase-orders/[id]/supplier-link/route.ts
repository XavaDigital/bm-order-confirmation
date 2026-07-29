import { NextResponse } from 'next/server';
import { defineRoute } from '@/lib/route-handler';
import {
  generateSupplierPortalLink,
  revokeSupplierPortalLink,
} from '@/server/purchase-orders/service';

export const POST = defineRoute<{ id: string }>({
  auth: 'staff',
  tag: 'purchase-orders/[id]/supplier-link POST',
  handler: async ({ params, session }) => {
    const url = await generateSupplierPortalLink(params.id, { actorEmail: session!.email });
    return NextResponse.json({ url });
  },
});

export const DELETE = defineRoute<{ id: string }>({
  auth: 'staff',
  tag: 'purchase-orders/[id]/supplier-link DELETE',
  handler: async ({ params, session }) => {
    await revokeSupplierPortalLink(params.id, { actorEmail: session!.email });
    return NextResponse.json({ ok: true });
  },
});
