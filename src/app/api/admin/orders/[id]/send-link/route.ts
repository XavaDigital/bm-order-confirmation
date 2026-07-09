import { NextRequest, NextResponse } from 'next/server';
import { generateAccessToken, getOrderAdmin, NotFoundError, ConflictError } from '@/server/orders/service';
import { recordAuditEvent, getChangesRequestedComment, getChangesRequestedCount } from '@/server/events/outbox';
import { sendMagicLink, isEmailConfigured } from '@/lib/email';
import { getSession } from '@/lib/session';

type Params = { params: Promise<{ id: string }> };

/**
 * Generate (or regenerate) the customer magic link and send it via email.
 * Returns the new URL so the ShareLinkPanel can update immediately.
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

    const { token, url } = await generateAccessToken(orderId, { actorEmail: session.email });

    const isRevision = order.status === 'changes_requested';
    const [priorComment, revisionNumber] = isRevision
      ? await Promise.all([
          getChangesRequestedComment(orderId),
          getChangesRequestedCount(orderId),
        ])
      : [null, 0];

    await sendMagicLink({
      to: order.customerEmail,
      toName: order.customerName,
      orderNumber: order.orderNumber,
      url,
      isRevision,
      priorComment: priorComment ?? undefined,
      revisionNumber: revisionNumber > 0 ? revisionNumber : undefined,
    });

    await recordAuditEvent({
      aggregateId: orderId,
      eventType: 'link.emailed',
      payload: {
        to: order.customerEmail,
        orderNumber: order.orderNumber,
        actorEmail: session.email ?? null,
        orderStatus: order.status,
      },
    });

    // token is intentionally not returned — only the URL is needed in the UI
    void token;

    return NextResponse.json({ ok: true, url }, { status: 200 });
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    if (err instanceof ConflictError) return NextResponse.json({ error: err.message }, { status: 409 });
    console.error('[admin/send-link POST]', err);
    const msg = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
