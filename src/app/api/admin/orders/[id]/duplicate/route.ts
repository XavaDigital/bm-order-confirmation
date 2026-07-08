import { NextRequest, NextResponse } from 'next/server';
import { duplicateOrder, NotFoundError } from '@/server/orders/service';
import { getSession } from '@/lib/session';

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params;

  try {
    const session = await getSession();
    const result = await duplicateOrder(id, session.userId, { actorEmail: session.email });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    console.error('[admin/orders/duplicate POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
