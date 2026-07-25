import { NextResponse } from 'next/server';
import { NotFoundError } from '@/server/orders/service';
import { emailRosterMemberLinks } from '@/server/notifications/service';
import { isEmailConfigured } from '@/lib/email';
import { serviceUnavailable } from '@/lib/api-responses';
import { defineRoute } from '@/lib/route-handler';
import { logger } from '@/lib/logger';

/**
 * Bulk "email everyone their individual link" (TEAM_ROSTER_PLAN.md Phase 9).
 * Mints a fresh per-member token and sends it to every member who has an
 * email on file; members without one are silently skipped and counted.
 */
export const POST = defineRoute<{ id: string }>({
  auth: 'staff',
  tag: 'admin/roster/email-links POST',
  handler: async ({ params, session }) => {
    if (!isEmailConfigured()) {
      return serviceUnavailable('Email delivery is not configured on this server.');
    }

    try {
      const result = await emailRosterMemberLinks(params.id, { actorEmail: session!.email });
      return NextResponse.json(result);
    } catch (err) {
      // NotFoundError falls through to the wrapper's 404 mapping. Anything else
      // (e.g. an email-send failure) surfaces its message to the admin UI
      // instead of the generic 500 body.
      if (err instanceof NotFoundError) throw err;
      logger.error('[admin/roster/email-links POST]', err);
      const msg = err instanceof Error ? err.message : 'Internal server error';
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  },
});
