/**
 * Structured logging + optional best-effort error reporting (roadmap 3.4).
 *
 * Dev: pretty console output, close to the `console.error('[ctx]', err)`
 * style this replaces. Prod: one JSON object per line on stdout, so any log
 * aggregator that tails the process output can parse it — no vendor lock-in.
 *
 * error() additionally does a fire-and-forget delivery to Sentry's envelope
 * ingestion API when SENTRY_DSN is set — hand-rolled via fetch (no SDK
 * dependency), matching the raw-fetch style already used for third-party
 * APIs in this codebase (see src/server/conversions/google-ads.ts). Absent
 * SENTRY_DSN, this is a complete no-op — same degrade-gracefully contract as
 * every other optional integration in src/lib/env.ts.
 */
import { env } from '@/lib/env';

type LogLevel = 'info' | 'warn' | 'error';

function serializeArg(arg: unknown): unknown {
  if (arg instanceof Error) {
    return { name: arg.name, message: arg.message, stack: arg.stack };
  }
  return arg;
}

function emit(level: LogLevel, message: string, args: unknown[]): void {
  const time = new Date().toISOString();
  const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;

  if (env.NODE_ENV === 'production') {
    consoleFn(JSON.stringify({ time, level, message, context: args.map(serializeArg) }));
  } else {
    consoleFn(`[${time}] ${level.toUpperCase()} ${message}`, ...args);
  }

  if (level === 'error') {
    void reportError(message, args);
  }
}

export const logger = {
  info: (message: string, ...args: unknown[]) => emit('info', message, args),
  warn: (message: string, ...args: unknown[]) => emit('warn', message, args),
  error: (message: string, ...args: unknown[]) => emit('error', message, args),
};

// ---------------------------------------------------------------------------
// Sentry (optional — SENTRY_DSN absent = no-op)
// ---------------------------------------------------------------------------

function sentryEnvelopeUrl(dsn: string): string | null {
  try {
    const url = new URL(dsn);
    const publicKey = url.username;
    const projectId = url.pathname.replace(/^\//, '');
    if (!publicKey || !projectId) return null;
    return `${url.protocol}//${url.host}/api/${projectId}/envelope/?sentry_key=${publicKey}&sentry_version=7`;
  } catch {
    return null;
  }
}

async function reportError(message: string, args: unknown[]): Promise<void> {
  if (!env.SENTRY_DSN) return;
  const envelopeUrl = sentryEnvelopeUrl(env.SENTRY_DSN);
  if (!envelopeUrl) return;

  const err = args.find((a): a is Error => a instanceof Error);
  const eventId = crypto.randomUUID().replace(/-/g, '');
  const timestamp = new Date().toISOString();

  const event = {
    event_id: eventId,
    timestamp,
    platform: 'node',
    level: 'error',
    logger: 'bm-order-confirmation',
    message: { formatted: message },
    ...(err ? { exception: { values: [{ type: err.name, value: err.message }] } } : {}),
    extra: { args: args.map(serializeArg) },
  };

  const body = [
    JSON.stringify({ event_id: eventId, sent_at: timestamp }),
    JSON.stringify({ type: 'event' }),
    JSON.stringify(event),
  ].join('\n');

  try {
    await fetch(envelopeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-sentry-envelope' },
      body,
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Best-effort — a monitoring-delivery failure must never mask the original error.
  }
}
