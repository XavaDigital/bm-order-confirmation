import { NextRequest, NextResponse } from 'next/server';
import { getRoster } from '@/server/roster/service';
import { NotFoundError } from '@/server/orders/service';
import { logger } from '@/lib/logger';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id: orderId } = await params;
  try {
    const roster = await getRoster(orderId);
    return NextResponse.json(roster);
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    logger.error('[admin/roster GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
