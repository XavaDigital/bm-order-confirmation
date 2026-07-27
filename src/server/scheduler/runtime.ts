/**
 * In-process job scheduler.
 *
 * This app ships as a long-lived container (see Dockerfile + next.config.ts
 * `output: 'standalone'`), so it schedules its own recurring work rather than
 * depending on an external scheduler. That choice is deliberate:
 *
 *  - The app already needs an always-warm instance for the real-time
 *    notification stream, so an in-process ticker costs no extra infrastructure.
 *  - It cannot be "forgotten to be wired up". The outbox previously never
 *    drained in production because the cron endpoint exported POST while
 *    schedulers issue GET — a silent integration mismatch. Code that ships with
 *    its own schedule can't drift from the thing it drives.
 *  - Multi-instance safety is already handled where it matters: the outbox
 *    claims rows with FOR UPDATE SKIP LOCKED, and the periodic scans take a
 *    Postgres advisory lock. Running two containers is safe, just redundant.
 *
 * The HTTP endpoints under /api/internal/** remain, so an external scheduler
 * can still drive this (set SCHEDULER_DISABLED=1 to avoid double-running) and
 * so a human can force a tick while debugging.
 *
 * Trade-off worth knowing: if the host scales to zero, in-process timers stop.
 * An external scheduler would wake the app over HTTP instead. Every job here is
 * idempotent and time-based, so a missed tick self-heals on the next one.
 */
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

export interface ScheduledJob {
  name: string;
  intervalMs: number;
  /** Must be idempotent — a tick can be missed, retried, or run concurrently
   *  with the same job in another container. */
  run: () => Promise<unknown>;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * The jobs. Handlers are imported lazily inside `run` so that merely importing
 * this module never pulls in the database layer — which matters because
 * instrumentation is evaluated in contexts (builds, edge) where that would be
 * wrong or would fail.
 */
export function scheduledJobs(): ScheduledJob[] {
  return [
    {
      name: 'process-outbox',
      intervalMs: MINUTE,
      run: async () => {
        const { processOutbox } = await import('@/server/events/processor');
        return processOutbox();
      },
    },
    {
      name: 'purge-rate-limits',
      intervalMs: 6 * HOUR,
      run: async () => {
        const { purgeExpiredRateLimits } = await import('@/lib/rate-limit');
        return purgeExpiredRateLimits();
      },
    },
    // Phase 6 adds the time-driven scans here (stuck stages, stale orders, due
    // reminders) as a single hourly job guarded by an advisory lock.
  ];
}

/** Reasons the scheduler deliberately stays off, so startup can say which. */
function skipReason(): string | null {
  // Only the Node.js server runtime — never edge, never the browser bundle.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return `runtime=${process.env.NEXT_RUNTIME}`;
  // `next build` evaluates server code while collecting page data.
  if (process.env.NEXT_PHASE === 'phase-production-build') return 'build';
  // Tests drive the jobs directly; a background ticker would poison them.
  if (process.env.VITEST || env.NODE_ENV === 'test') return 'test';
  if (process.env.SCHEDULER_DISABLED === '1') return 'SCHEDULER_DISABLED=1';
  return null;
}

const timers: NodeJS.Timeout[] = [];
let started = false;

/**
 * Run one job, swallowing failures. A throwing job must never take the process
 * down or stop its own future ticks, and must never overlap itself: a slow
 * outbox run on a big backlog would otherwise pile up behind itself.
 */
function makeTicker(job: ScheduledJob): () => Promise<void> {
  let inFlight = false;
  return async () => {
    if (inFlight) {
      logger.warn('scheduler: skipping tick, previous run still in flight', { job: job.name });
      return;
    }
    inFlight = true;
    const startedAt = Date.now();
    try {
      const result = await job.run();
      logger.info('scheduler: job finished', {
        job: job.name,
        ms: Date.now() - startedAt,
        result,
      });
    } catch (err) {
      logger.error('scheduler: job failed', err, { job: job.name });
    } finally {
      inFlight = false;
    }
  };
}

/**
 * Start the scheduler. Idempotent — dev hot-reload re-runs instrumentation, and
 * a second set of timers would double every job.
 */
export function startScheduler(jobs: ScheduledJob[] = scheduledJobs()): void {
  const skip = skipReason();
  if (skip) {
    logger.info('scheduler: not started', { reason: skip });
    return;
  }
  if (started) return;
  started = true;

  for (const job of jobs) {
    const tick = makeTicker(job);
    // Stagger the first run: a rolling deploy would otherwise have every new
    // container hit the database in the same instant.
    const initialDelay = Math.floor(Math.random() * Math.min(job.intervalMs, 30_000));
    const timer = setInterval(tick, job.intervalMs);
    // Don't hold the event loop open purely for a timer.
    timer.unref?.();
    timers.push(timer);
    setTimeout(() => void tick(), initialDelay).unref?.();
  }

  logger.info('scheduler: started', {
    jobs: jobs.map((j) => `${j.name}@${Math.round(j.intervalMs / 1000)}s`),
  });

  const stop = () => stopScheduler();
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

/** Clear all timers — used on shutdown and by tests. */
export function stopScheduler(): void {
  for (const timer of timers) clearInterval(timer);
  timers.length = 0;
  started = false;
}
