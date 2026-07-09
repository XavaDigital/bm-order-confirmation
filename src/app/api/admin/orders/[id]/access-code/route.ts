import { NextRequest, NextResponse } from 'next/server';
import { setOrderAccessCode, clearOrderAccessCode, ConflictError } from '@/server/orders/service';
import { getSession } from '@/lib/session';

type Params = { params: Promise<{ id: string }> };

/**
 * Enable (or rotate) the per-order access code on the active customer link.
 * The raw code is returned ONCE — staff relay it out-of-band (phone/text).
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const { id: orderId } = await params;
  try {
    const session = await getSession();
    const result = await setOrderAccessCode(orderId, { actorEmail: session.email });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof ConflictError) return NextResponse.json({ error: err.message }, { status: 409 });
    console.error('[admin/access-code POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** Remove the access code — the link alone opens the order again. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id: orderId } = await params;
  try {
    const session = await getSession();
    await clearOrderAccessCode(orderId, { actorEmail: session.email });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[admin/access-code DELETE]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
