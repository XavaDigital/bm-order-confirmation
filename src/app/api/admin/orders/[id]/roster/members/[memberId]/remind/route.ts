import { NextRequest, NextResponse } from 'next/server';
import { generateMemberToken, getRosterMember } from '@/server/roster/service';
import { getOrderAdmin, NotFoundError } from '@/server/orders/service';
import { recordAuditEvent } from '@/server/events/outbox';
import { sendRosterReminderEmail, isEmailConfigured } from '@/lib/email';
import { getSession } from '@/lib/session';

type Params = { params: Promise<{ id: string; memberId: string }> };

/**
 * Nudge a single pending roster member by email with their own individual
 * link (TEAM_ROSTER_PLAN.md Phase 9) — targeted, unlike the earlier v1
 * behavior which had to regenerate the shared roster link for everyone.
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const { id: orderId, memberId } = await params;

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

    const member = await getRosterMember(orderId, memberId);
    if (!member.email) {
      return NextResponse.json({ error: 'This team member has no email on file' }, { status: 400 });
    }

    const { url } = await generateMemberToken(memberId, { actorEmail: session.email });

    await sendRosterReminderEmail({
      to: member.email,
      toName: member.name,
      orderNumber: order.orderNumber,
      clubName: order.clubName,
      url,
    });

    await recordAuditEvent({
      aggregateId: orderId,
      eventType: 'roster.reminder_sent',
      payload: { memberId: member.id, name: member.name, to: member.email, actorEmail: session.email ?? null },
    });

    return NextResponse.json({ ok: true, url }, { status: 200 });
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    console.error('[admin/roster/members/remind POST]', err);
    const msg = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
