import { NextRequest, NextResponse } from 'next/server';
import { getOrderAuditLog } from '@/server/events/outbox';
import { logger } from '@/lib/logger';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id: orderId } = await params;
  try {
    const events = await getOrderAuditLog(orderId);
    return NextResponse.json({ events });
  } catch (err) {
    logger.error('[admin/audit GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
