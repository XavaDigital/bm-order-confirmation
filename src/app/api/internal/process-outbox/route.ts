/**
 * POST /api/internal/process-outbox
 *
 * Cron-callable endpoint that flushes pending domain_events to their handlers.
 *
 * To wire up in production, call this endpoint on a schedule:
 *   - Vercel Cron: add to vercel.json → { "crons": [{ "path": "/api/internal/process-outbox", "schedule": "* * * * *" }] }
 *     Vercel sends `Authorization: Bearer $CRON_SECRET` on these requests, not
 *     x-api-key — set the CRON_SECRET env var (see src/lib/env.ts) for this to work.
 *   - External cron (Supabase Edge Functions, Railway, etc.): POST with header
 *     x-api-key: <INTERNAL_API_KEY>
 *
 * Response:
 *   { processed: number, delivered: number, failed: number }
 */
import { NextResponse } from 'next/server';
import { isInternalAuthorized, isCronAuthorized } from '@/lib/api-auth';
import { processOutbox } from '@/server/events/processor';
import { purgeExpiredRateLimits } from '@/lib/rate-limit';
import { defineRoute } from '@/lib/route-handler';

export const POST = defineRoute({
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
