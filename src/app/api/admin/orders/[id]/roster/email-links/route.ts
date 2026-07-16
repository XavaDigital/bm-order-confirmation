import { NextRequest, NextResponse } from 'next/server';
import { generateMemberToken, getRoster } from '@/server/roster/service';
import { getOrderAdmin, NotFoundError } from '@/server/orders/service';
import { recordAuditEvent } from '@/server/events/outbox';
import { sendRosterMemberLinkEmail, isEmailConfigured } from '@/lib/email';
import { getSession } from '@/lib/session';
import { logger } from '@/lib/logger';

type Params = { params: Promise<{ id: string }> };

/**
 * Bulk "email everyone their individual link" (TEAM_ROSTER_PLAN.md Phase 9).
 * Mints a fresh per-member token and sends it to every member who has an
 * email on file; members without one are silently skipped and counted.
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

    const { members } = await getRoster(orderId);
    const withEmail = members.filter((m) => m.email);

    let sent = 0;
    for (const member of withEmail) {
      const { url } = await generateMemberToken(member.id, { actorEmail: session.email });
      await sendRosterMemberLinkEmail({
        to: member.email!,
        toName: member.name,
        orderNumber: order.orderNumber,
        clubName: order.clubName,
        url,
      });
      await recordAuditEvent({
        aggregateId: orderId,
        eventType: 'roster.member_link_emailed',
        payload: { memberId: member.id, name: member.name, to: member.email, actorEmail: session.email ?? null },
      });
      sent++;
    }

    return NextResponse.json({
      sent,
      skippedNoEmail: members.length - withEmail.length,
      total: members.length,
    });
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    logger.error('[admin/roster/email-links POST]', err);
    const msg = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
