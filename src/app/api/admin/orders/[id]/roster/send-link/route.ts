import { NextRequest, NextResponse } from 'next/server';
import { generateRosterToken } from '@/server/roster/service';
import { getOrderAdmin, NotFoundError } from '@/server/orders/service';
import { recordAuditEvent } from '@/server/events/outbox';
import { sendRosterLinkEmail, isEmailConfigured } from '@/lib/email';
import { getSession } from '@/lib/session';
import { logger } from '@/lib/logger';

type Params = { params: Promise<{ id: string }> };

/**
 * Generate (or regenerate) the shared team-roster link and email it to the
 * order's customer (the team manager) in one step.
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const { id: orderId } = await params;

  if (!isEmailConfigured()) {
    return NextResponse.json(
      { error: 'Email delivery is not configured on this server.' },
      { status: 503 },
    );
  }

  try {
    const session = await getSession();
    const order = await getOrderAdmin(orderId);
    if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { url } = await generateRosterToken(orderId, { actorEmail: session.email });

    await sendRosterLinkEmail({
      to: order.customerEmail,
      toName: order.customerName,
      orderNumber: order.orderNumber,
      clubName: order.clubName,
      url,
    });

    await recordAuditEvent({
      aggregateId: orderId,
      eventType: 'roster.link_emailed',
      payload: { to: order.customerEmail, actorEmail: session.email ?? null },
    });

    return NextResponse.json({ ok: true, url }, { status: 200 });
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    logger.error('[admin/roster/send-link POST]', err);
    const msg = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
