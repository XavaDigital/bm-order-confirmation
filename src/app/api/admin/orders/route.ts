import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { listOrders, createOrder, NotFoundError, ConflictError } from '@/server/orders/service';
import { createOrderSchema } from '@/server/orders/contract';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const status = searchParams.get('status') ?? undefined;
  const search = searchParams.get('search') ?? undefined;
  const limit = Number(searchParams.get('limit') ?? 100);
  const offset = Number(searchParams.get('offset') ?? 0);

  try {
    const result = await listOrders({ status, search, limit, offset });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[admin/orders GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  const body = await request.json().catch(() => null);
  const parsed = createOrderSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const result = await createOrder(parsed.data, session.userId);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error('[admin/orders POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
