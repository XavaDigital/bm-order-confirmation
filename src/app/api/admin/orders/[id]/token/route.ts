import { NextRequest, NextResponse } from 'next/server';
import { generateAccessToken, revokeAccessToken, NotFoundError } from '@/server/orders/service';

type Params = { params: Promise<{ id: string }> };

/** Generate (or regenerate) the customer magic link for this order. */
export async function POST(_req: NextRequest, { params }: Params) {
  const { id: orderId } = await params;
  try {
    const result = await generateAccessToken(orderId);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    console.error('[admin/token POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** Revoke the current customer magic link. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id: orderId } = await params;
  try {
    await revokeAccessToken(orderId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[admin/token DELETE]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
