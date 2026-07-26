/**
 * GET|POST /api/internal/process-outbox
 *
 * Cron-callable endpoint that flushes pending domain_events to their handlers.
 * Both verbs are exported with identical behaviour because schedulers differ on
 * which they issue (Google Cloud Scheduler and Vercel Cron default to GET); a
 * POST-only route silently 405s forever and the outbox never drains.
 *
 * Auth (either):
 *   - `Authorization: Bearer <CRON_SECRET>`  — schedulers
 *   - `x-api-key: <INTERNAL_API_KEY>`        — manual/service calls
 *
 * Wiring (see also /api/internal/run-scheduler, the hourly companion):
 *   gcloud scheduler jobs create http bm-order-confirmation-outbox \
 *     --schedule="*\/5 * * * *" --uri="https://<host>/api/internal/process-outbox" \
 *     --http-method=GET --headers="Authorization=Bearer <CRON_SECRET>"
 *
 * This app deploys as a standalone container (see next.config.ts `output`), so
 * vercel.json is NOT the mechanism here.
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
