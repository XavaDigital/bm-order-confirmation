/**
 * Notification service — owns the full "mint a link and email it" flows that
 * used to be orchestrated inline in the send-link / roster email routes.
 *
 * Each function loads its entities (throwing NotFoundError exactly where the
 * route previously returned 404), mints the token via the owning service,
 * sends the email via @/lib/email, then records the audit event. The routes
 * are left with only the isEmailConfigured() 503 gate and their custom
 * 500-with-message catch.
 *
 * Email sends go through the `email.*` namespace so tests that mock
 * '@/lib/email' with a subset of exports still load this module.
 */
import * as email from '@/lib/email';
import {
  generateAccessToken,
  getOrderAdmin,
  ConflictError,
  NotFoundError,
} from '@/server/orders/service';
import {
  generateMemberToken,
  generateRosterToken,
  getRoster,
  getRosterMember,
} from '@/server/roster/service';
import {
  getChangesRequestedComment,
  getChangesRequestedCount,
  recordAuditEvent,
} from '@/server/events/outbox';

/** Thrown when a roster-member email flow targets a member with no email on file. */
export class MemberHasNoEmailError extends Error {
  constructor(message = 'This team member has no email on file') {
    super(message);
    this.name = 'MemberHasNoEmailError';
  }
}

/**
 * Generate (or regenerate) the customer magic link and email it — including
 * the revision context (prior comment / round number) when the order is in
 * changes_requested.
 */
export async function sendOrderConfirmationLink(
  orderId: string,
  meta: { actorEmail?: string },
): Promise<{ url: string }> {
  const order = await getOrderAdmin(orderId);
  if (!order) throw new NotFoundError('Order');

  /**
   * A hub-linked order can be created with the contact/branding fields blank
   * (they resolve from the CRM, whose contact may have no email). The order
   * page cannot be SENT without one — enforced here, at send time, with words
   * that say what to do, rather than at create time where it would block the
   * email-relay flow.
   */
  if (!order.customerEmail || !order.customerName) {
    throw new ConflictError(
      'Add a contact name and email under "Order page contact & branding" before sending the order page.',
    );
  }

  const { url } = await generateAccessToken(orderId, { actorEmail: meta.actorEmail });

  const isRevision = order.status === 'changes_requested';
  const [priorComment, revisionNumber] = isRevision
    ? await Promise.all([
        getChangesRequestedComment(orderId),
        getChangesRequestedCount(orderId),
      ])
    : [null, 0];

  await email.sendMagicLink({
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
    payload: { to: order.customerEmail, orderNumber: order.orderNumber, orderStatus: order.status },
    actorEmail: meta.actorEmail ?? null,
  });

  return { url };
}

/**
 * Generate (or regenerate) the shared team-roster link and email it to the
 * order's customer (the team manager).
 */
export async function sendRosterLink(
  orderId: string,
  meta: { actorEmail?: string },
): Promise<{ url: string }> {
  const order = await getOrderAdmin(orderId);
  if (!order) throw new NotFoundError('Order');

  const { url } = await generateRosterToken(orderId, { actorEmail: meta.actorEmail });

  await email.sendRosterLinkEmail({
    to: order.customerEmail,
    toName: order.customerName,
    orderNumber: order.orderNumber,
    clubName: order.clubName,
    url,
  });

  await recordAuditEvent({
    aggregateId: orderId,
    eventType: 'roster.link_emailed',
    payload: { to: order.customerEmail },
    actorEmail: meta.actorEmail ?? null,
  });

  return { url };
}

/**
 * Bulk "email everyone their individual link" (TEAM_ROSTER_PLAN.md Phase 9).
 * Mints a fresh per-member token and sends it to every member with an email
 * on file; members without one are silently skipped and counted. A failure
 * partway through propagates — members already emailed keep their sent link
 * and audit row (same partial-failure behavior as the original route loop).
 */
export async function emailRosterMemberLinks(
  orderId: string,
  meta: { actorEmail?: string },
): Promise<{ sent: number; skippedNoEmail: number; total: number }> {
  const order = await getOrderAdmin(orderId);
  if (!order) throw new NotFoundError('Order');

  const { members } = await getRoster(orderId);
  const withEmail = members.filter((m) => m.email);

  let sent = 0;
  for (const member of withEmail) {
    const { url } = await generateMemberToken(member.id, { actorEmail: meta.actorEmail });
    await email.sendRosterMemberLinkEmail({
      to: member.email!,
      toName: member.name,
      orderNumber: order.orderNumber,
      clubName: order.clubName,
      url,
    });
    await recordAuditEvent({
      aggregateId: orderId,
      eventType: 'roster.member_link_emailed',
      payload: { memberId: member.id, name: member.name, to: member.email },
      actorEmail: meta.actorEmail ?? null,
    });
    sent++;
  }

  return {
    sent,
    skippedNoEmail: members.length - withEmail.length,
    total: members.length,
  };
}

/**
 * Nudge a single pending roster member by email with their own individual
 * link (TEAM_ROSTER_PLAN.md Phase 9). Throws MemberHasNoEmailError when the
 * member has no email on file (the route maps it to a 400).
 */
export async function sendRosterMemberReminder(
  orderId: string,
  memberId: string,
  meta: { actorEmail?: string },
): Promise<{ url: string }> {
  const order = await getOrderAdmin(orderId);
  if (!order) throw new NotFoundError('Order');

  const member = await getRosterMember(orderId, memberId);
  if (!member.email) throw new MemberHasNoEmailError();

  const { url } = await generateMemberToken(memberId, { actorEmail: meta.actorEmail });

  await email.sendRosterReminderEmail({
    to: member.email,
    toName: member.name,
    orderNumber: order.orderNumber,
    clubName: order.clubName,
    url,
  });

  await recordAuditEvent({
    aggregateId: orderId,
    eventType: 'roster.reminder_sent',
    payload: { memberId: member.id, name: member.name, to: member.email },
    actorEmail: meta.actorEmail ?? null,
  });

  return { url };
}
