import { NextResponse } from 'next/server';
import { defineRoute } from '@/lib/route-handler';
import {
  createPurchaseOrder,
  listPurchaseOrders,
} from '@/server/purchase-orders/service';
import {
  createPurchaseOrderSchema,
  PO_STATUSES,
  type PoStatus,
} from '@/server/purchase-orders/contract';

export const GET = defineRoute({
  auth: 'viewer',
  tag: 'purchase-orders GET',
  handler: async ({ request }) => {
    const params = request.nextUrl.searchParams;
    const rawStatus = params.get('status');
    const status = PO_STATUSES.includes(rawStatus as PoStatus)
      ? (rawStatus as PoStatus)
      : undefined;
    return NextResponse.json(
      await listPurchaseOrders({
        status,
        supplierId: params.get('supplierId') ?? undefined,
        search: params.get('search') ?? undefined,
      }),
    );
  },
});

export const POST = defineRoute({
  auth: 'staff',
  tag: 'purchase-orders POST',
  schema: createPurchaseOrderSchema,
  handler: async ({ body, session }) => {
    const po = await createPurchaseOrder(body, {
      actorStaffUserId: session!.userId,
      actorEmail: session!.email,
    });
    return NextResponse.json(po, { status: 201 });
  },
});
