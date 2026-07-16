import { NextRequest, NextResponse } from 'next/server';
import { resolveColorSampleRequest, NotFoundError } from '@/server/orders/service';
import { getSession } from '@/lib/session';
import { logger } from '@/lib/logger';

type Params = { params: Promise<{ id: string }> };

/** Clear the "hold production" colour-sample flag once it's been arranged with the customer. */
export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params;

  try {
    const session = await getSession();
    await resolveColorSampleRequest(id, { actorEmail: session.email });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    logger.error('[admin/orders/resolve-color-sample POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
