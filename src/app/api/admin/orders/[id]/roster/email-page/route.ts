import { NextResponse } from 'next/server';
import { NotFoundError, ConflictError } from '@/server/orders/service';
import { sendRosterPageLink } from '@/server/notifications/service';
import { isEmailConfigured } from '@/lib/email';
import { serviceUnavailable } from '@/lib/api-responses';
import { defineRoute } from '@/lib/route-handler';
import { logger } from '@/lib/logger';

/**
 * Email the roster page address + team password to the order's customer
 * (David, 2026-08-04). Mints nothing — the page URL and password are durable.
 */
export const POST = defineRoute<{ id: string }>({
  auth: 'staff',
  tag: 'orders/[id]/roster/email-page POST',
  handler: async ({ params, session }) => {
    if (!isEmailConfigured()) {
      return serviceUnavailable('Email delivery is not configured on this server.');
    }

    try {
      const { url } = await sendRosterPageLink(params.id, { actorEmail: session!.email });
      return NextResponse.json({ ok: true, url }, { status: 200 });
    } catch (err) {
      if (err instanceof NotFoundError || err instanceof ConflictError) throw err;
      logger.error('[orders/[id]/roster/email-page POST]', err);
      const msg = err instanceof Error ? err.message : 'Internal server error';
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  },
});
