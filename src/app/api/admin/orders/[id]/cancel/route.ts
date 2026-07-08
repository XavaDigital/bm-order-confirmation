import { NextRequest, NextResponse } from 'next/server';
import { cancelOrder, NotFoundError, ConflictError } from '@/server/orders/service';
import { getSession } from '@/lib/session';

type Params = { params: Promise<{ id: string }> };

/** Mark a dead deal as cancelled and revoke its customer link. */
export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params;

  try {
    const session = await getSession();
    await cancelOrder(id, { actorEmail: session.email });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    if (err instanceof ConflictError) return NextResponse.json({ error: err.message }, { status: 409 });
    console.error('[admin/orders/cancel POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
