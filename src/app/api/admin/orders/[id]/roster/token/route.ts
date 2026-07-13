import { NextRequest, NextResponse } from 'next/server';
import { generateRosterToken, revokeRosterToken } from '@/server/roster/service';
import { NotFoundError } from '@/server/orders/service';
import { getSession } from '@/lib/session';

type Params = { params: Promise<{ id: string }> };

/** Generate (or regenerate) the shared team-roster link for this order. */
export async function POST(_req: NextRequest, { params }: Params) {
  const { id: orderId } = await params;
  try {
    const session = await getSession();
    const result = await generateRosterToken(orderId, { actorEmail: session.email });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    console.error('[admin/roster/token POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** Revoke the current team-roster link. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id: orderId } = await params;
  try {
    const session = await getSession();
    await revokeRosterToken(orderId, { actorEmail: session.email });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[admin/roster/token DELETE]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
