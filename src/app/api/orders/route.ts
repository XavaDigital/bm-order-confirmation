import { NextResponse } from 'next/server';
import { isInternalAuthorized } from '@/lib/api-auth';
import { createOrderSchema } from '@/server/orders/contract';
import { createOrder, listOrders } from '@/server/orders/service';

export const dynamic = 'force-dynamic';

/**
 * Order ingestion endpoint — THE integration seam (PROJECT_BRIEF.md §15).
 * The admin UI and the future sales platform both create orders here.
 */
export async function POST(req: Request) {
  if (!isInternalAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const parsed = createOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation failed', details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const result = await createOrder(parsed.data);
  // `token`/`url` are returned ONCE so the caller can deliver the link. Not stored raw.
  return NextResponse.json(result, { status: 201 });
}

export async function GET(req: Request) {
  if (!isInternalAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const orders = await listOrders();
  return NextResponse.json({ orders });
}
