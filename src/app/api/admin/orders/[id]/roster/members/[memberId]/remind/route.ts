import { NextResponse } from 'next/server';
import { NotFoundError } from '@/server/orders/service';
import { sendRosterMemberReminder, MemberHasNoEmailError } from '@/server/notifications/service';
import { isEmailConfigured } from '@/lib/email';
import { serviceUnavailable } from '@/lib/api-responses';
import { defineRoute } from '@/lib/route-handler';
import { logger } from '@/lib/logger';

/**
 * Nudge a single pending roster member by email with their own individual
 * link (TEAM_ROSTER_PLAN.md Phase 9) — targeted, unlike the earlier v1
 * behavior which had to regenerate the shared roster link for everyone.
 */
export const POST = defineRoute<{ id: string; memberId: string }>({
  auth: 'staff',
  tag: 'admin/roster/members/remind POST',
  handler: async ({ params, session }) => {
    if (!isEmailConfigured()) {
      return serviceUnavailable('Email delivery is not configured on this server.');
    }

    try {
      const { url } = await sendRosterMemberReminder(params.id, params.memberId, {
        actorEmail: session!.email,
      });
      return NextResponse.json({ ok: true, url }, { status: 200 });
    } catch (err) {
      // NotFoundError falls through to the wrapper's 404 mapping. Anything else
      // (e.g. an email-send failure) surfaces its message to the admin UI
      // instead of the generic 500 body.
      if (err instanceof NotFoundError) throw err;
      if (err instanceof MemberHasNoEmailError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      logger.error('[admin/roster/members/remind POST]', err);
      const msg = err instanceof Error ? err.message : 'Internal server error';
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  },
});
