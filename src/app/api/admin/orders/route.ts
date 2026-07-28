import { NextResponse } from 'next/server';
import { listOrders, createOrder } from '@/server/orders/service';
import { createOrderSchema } from '@/server/orders/contract';
import { defineRoute } from '@/lib/route-handler';

export const GET = defineRoute({
  auth: 'viewer',
  tag: 'orders GET',
  handler: async ({ request }) => {
    const { searchParams } = request.nextUrl;
    const status = searchParams.get('status') ?? undefined;
    const search = searchParams.get('search') ?? undefined;
    const sortBy = searchParams.get('sortBy') ?? undefined;
    const sortDir = searchParams.get('sortDir') ?? undefined;
    const limit = Number(searchParams.get('limit') ?? 100);
    const offset = Number(searchParams.get('offset') ?? 0);

    const result = await listOrders({ status, search, limit, offset, sortBy, sortDir });
    return NextResponse.json(result);
  },
});

export const POST = defineRoute<Record<string, never>, typeof createOrderSchema._type>({
  auth: 'staff',
  tag: 'orders POST',
  schema: createOrderSchema,
  handler: async ({ body, session }) => {
    const result = await createOrder(body, session!.userId);
    return NextResponse.json(result, { status: 201 });
  },
});
