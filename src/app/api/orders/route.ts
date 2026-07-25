import { NextResponse } from 'next/server';
import { isInternalAuthorized } from '@/lib/api-auth';
import { createOrderSchema } from '@/server/orders/contract';
import { createOrder, listOrders } from '@/server/orders/service';
import { defineRoute } from '@/lib/route-handler';
import { badRequest } from '@/lib/api-responses';

export const dynamic = 'force-dynamic';

/**
 * Order ingestion endpoint — THE integration seam (PROJECT_BRIEF.md §15).
 * The admin UI and the future sales platform both create orders here.
 *
 * No `schema` on the wrapper: the x-api-key check must run BEFORE body
 * validation so unauthenticated callers can't probe payload validity.
 */
export const POST = defineRoute({
  auth: 'public',
  tag: 'orders POST',
  handler: async ({ request }) => {
    if (!isInternalAuthorized(request)) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const parsed = createOrderSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return badRequest(parsed.error);

    const result = await createOrder(parsed.data);
    // `token`/`url` are returned ONCE so the caller can deliver the link. Not stored raw.
    return NextResponse.json(result, { status: 201 });
  },
});

export const GET = defineRoute({
  auth: 'public',
  tag: 'orders GET',
  handler: async ({ request }) => {
    if (!isInternalAuthorized(request)) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    const orders = await listOrders();
    return NextResponse.json({ orders });
  },
});
