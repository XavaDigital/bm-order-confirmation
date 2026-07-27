/**
 * GET|POST /api/internal/process-outbox — flush pending domain_events.
 *
 * NOT the primary mechanism: recurring work runs in-process
 * (src/server/scheduler/runtime.ts, started from instrumentation.ts). This route
 * exists so a human can force a tick while debugging, and so an external
 * scheduler can drive the app instead — set SCHEDULER_DISABLED=1 in that case so
 * the two don't both run. See README §6.
 *
 * Both verbs are exported with identical behaviour because external schedulers
 * differ on which they issue (most default to GET); a POST-only route silently
 * 405s forever, which is exactly how the outbox came to never drain.
 *
 * Auth (either):
 *   - `Authorization: Bearer <CRON_SECRET>`  — external schedulers
 *   - `x-api-key: <INTERNAL_API_KEY>`        — manual/service calls
 *
 * Response: { processed, delivered, failed, purgedRateLimits }
 */
import { NextResponse } from 'next/server';
import { isInternalAuthorized, isCronAuthorized } from '@/lib/api-auth';
import { processOutbox } from '@/server/events/processor';
import { purgeExpiredRateLimits } from '@/lib/rate-limit';
import { defineRoute } from '@/lib/route-handler';

const handler = defineRoute({
  auth: 'public',
  tag: '/api/internal/process-outbox',
  handler: async ({ request }) => {
    if (!isInternalAuthorized(request) && !isCronAuthorized(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await processOutbox();
    // Piggyback housekeeping on the cron tick — best-effort, never throws.
    const purgedRateLimits = await purgeExpiredRateLimits();
    return NextResponse.json({ ...result, purgedRateLimits });
  },
});

export const GET = handler;
export const POST = handler;
