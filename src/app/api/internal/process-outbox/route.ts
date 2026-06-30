/**
 * POST /api/internal/process-outbox
 *
 * Cron-callable endpoint that flushes pending domain_events to their handlers.
 * Protected by the same INTERNAL_API_KEY used by the order ingestion API.
 *
 * To wire up in production, call this endpoint on a schedule:
 *   - Vercel Cron: add to vercel.json → { "crons": [{ "path": "/api/internal/process-outbox", "schedule": "* * * * *" }] }
 *     (Vercel injects a valid Authorization header automatically for Cron invocations.)
 *   - External cron (Supabase Edge Functions, Railway, etc.): POST with header
 *     x-api-key: <INTERNAL_API_KEY>
 *
 * Response:
 *   { processed: number, delivered: number, failed: number }
 */
import { NextRequest, NextResponse } from 'next/server';
import { isInternalAuthorized } from '@/lib/api-auth';
import { processOutbox } from '@/server/events/processor';

export async function POST(request: NextRequest) {
  if (!isInternalAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await processOutbox();
    return NextResponse.json(result);
  } catch (err) {
    console.error('[/api/internal/process-outbox]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
