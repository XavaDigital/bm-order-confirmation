import { NextResponse } from 'next/server';
import { NotFoundError } from '@/server/orders/service';
import { sendRosterLink } from '@/server/notifications/service';
import { isEmailConfigured } from '@/lib/email';
import { serviceUnavailable } from '@/lib/api-responses';
import { defineRoute } from '@/lib/route-handler';
import { logger } from '@/lib/logger';

/**
 * Generate (or regenerate) the shared team-roster link and email it to the
 * order's customer (the team manager) in one step.
 */
export const POST = defineRoute<{ id: string }>({
  auth: 'staff',
  tag: 'admin/roster/send-link POST',
  handler: async ({ params, session }) => {
    if (!isEmailConfigured()) {
      return serviceUnavailable('Email delivery is not configured on this server.');
    }

    try {
      const { url } = await sendRosterLink(params.id, { actorEmail: session!.email });
      return NextResponse.json({ ok: true, url }, { status: 200 });
    } catch (err) {
      // NotFoundError falls through to the wrapper's 404 mapping. Anything else
      // (e.g. an email-send failure) surfaces its message to the admin UI
      // instead of the generic 500 body.
      if (err instanceof NotFoundError) throw err;
      logger.error('[admin/roster/send-link POST]', err);
      const msg = err instanceof Error ? err.message : 'Internal server error';
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  },
});
