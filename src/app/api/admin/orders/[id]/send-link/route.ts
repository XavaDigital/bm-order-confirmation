import { NextResponse } from 'next/server';
import { NotFoundError, ConflictError } from '@/server/orders/service';
import { sendOrderConfirmationLink } from '@/server/notifications/service';
import { isEmailConfigured } from '@/lib/email';
import { serviceUnavailable } from '@/lib/api-responses';
import { defineRoute } from '@/lib/route-handler';
import { logger } from '@/lib/logger';

/**
 * Generate (or regenerate) the customer magic link and send it via email.
 * Returns the new URL so the ShareLinkPanel can update immediately.
 */
export const POST = defineRoute<{ id: string }>({
  auth: 'staff',
  tag: 'orders/[id]/send-link POST',
  handler: async ({ params, session }) => {
    if (!isEmailConfigured()) {
      return serviceUnavailable('Email delivery is not configured on this server.');
    }

    try {
      const { url } = await sendOrderConfirmationLink(params.id, { actorEmail: session!.email });
      return NextResponse.json({ ok: true, url }, { status: 200 });
    } catch (err) {
      // Let the wrapper map service not-found/conflict errors; anything else
      // (e.g. an SMTP failure) surfaces its message so staff can act on it.
      if (err instanceof NotFoundError || err instanceof ConflictError) throw err;
      logger.error('[orders/[id]/send-link POST]', err);
      const msg = err instanceof Error ? err.message : 'Internal server error';
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  },
});
