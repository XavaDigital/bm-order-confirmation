/**
 * GET|POST /api/internal/send-notification-emails — flush the email side of
 * the notifications inbox (see src/server/notifications/email-sender.ts).
 *
 * NOT the primary mechanism: recurring work runs in-process
 * (src/server/scheduler/runtime.ts, started from instrumentation.ts). This route
 * exists so a human can force a tick while debugging, and so an external
 * scheduler can drive the app instead — set SCHEDULER_DISABLED=1 in that case so
 * the two don't both run.
 *
 * Both verbs are exported with identical behaviour — see the same note on
 * /api/internal/process-outbox for why (a POST-only route silently 405s
 * forever against a GET-issuing scheduler).
 *
 * Auth (either):
 *   - `Authorization: Bearer <CRON_SECRET>`  — external schedulers
 *   - `x-api-key: <INTERNAL_API_KEY>`        — manual/service calls
 *
 * Response: { processed, sent, failed }
 */
import { NextResponse } from 'next/server';
import { isInternalAuthorized, isCronAuthorized } from '@/lib/api-auth';
import { sendPendingNotificationEmails } from '@/server/notifications/email-sender';
import { defineRoute } from '@/lib/route-handler';

const handler = defineRoute({
  auth: 'public',
  tag: '/api/internal/send-notification-emails',
  handler: async ({ request }) => {
    if (!isInternalAuthorized(request) && !isCronAuthorized(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await sendPendingNotificationEmails();
    return NextResponse.json(result);
  },
});

export const GET = handler;
export const POST = handler;
