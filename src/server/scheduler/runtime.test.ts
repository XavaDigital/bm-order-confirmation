import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/env', () => ({ env: { NODE_ENV: 'production' } }));

const { logger } = vi.hoisted(() => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/logger', () => ({ logger }));

import { startScheduler, stopScheduler, scheduledJobs, type ScheduledJob } from './runtime';

/** A job whose runs are observable and whose completion the test controls. */
function controllableJob(name = 'test-job', intervalMs = 1000) {
  const calls: number[] = [];
  let release: (() => void) | null = null;
  const job: ScheduledJob = {
    name,
    intervalMs,
    run: () => {
      calls.push(Date.now());
      return new Promise<void>((resolve) => {
        release = () => resolve();
      });
    },
  };
  return { job, calls, finish: () => release?.() };
}

const ORIGINAL_RUNTIME = process.env.NEXT_RUNTIME;

beforeEach(() => {
  vi.useFakeTimers();
  logger.info.mockClear();
  logger.warn.mockClear();
  logger.error.mockClear();
  // The guards check for a real server runtime; VITEST is set, so clear it for
  // the tests that need the scheduler to actually start.
  process.env.NEXT_RUNTIME = 'nodejs';
  delete process.env.VITEST;
  delete process.env.NEXT_PHASE;
  delete process.env.SCHEDULER_DISABLED;
});

afterEach(() => {
  stopScheduler();
  vi.useRealTimers();
  process.env.NEXT_RUNTIME = ORIGINAL_RUNTIME;
  process.env.VITEST = '1';
});

describe('startScheduler guards', () => {
  it('does not start outside the node server runtime', () => {
    process.env.NEXT_RUNTIME = 'edge';
    const { job, calls } = controllableJob();

    startScheduler([job]);
    vi.advanceTimersByTime(60_000);

    expect(calls).toHaveLength(0);
    expect(logger.info).toHaveBeenCalledWith('scheduler: not started', { reason: 'runtime=edge' });
  });

  it('does not start during a production build', () => {
    process.env.NEXT_PHASE = 'phase-production-build';
    const { job, calls } = controllableJob();

    startScheduler([job]);
    vi.advanceTimersByTime(60_000);

    expect(calls).toHaveLength(0);
  });

  it('does not start under test', () => {
    process.env.VITEST = '1';
    const { job, calls } = controllableJob();

    startScheduler([job]);
    vi.advanceTimersByTime(60_000);

    expect(calls).toHaveLength(0);
  });

  // Lets a deployment hand scheduling to an external driver without a code change.
  it('does not start when SCHEDULER_DISABLED=1', () => {
    process.env.SCHEDULER_DISABLED = '1';
    const { job, calls } = controllableJob();

    startScheduler([job]);
    vi.advanceTimersByTime(60_000);

    expect(calls).toHaveLength(0);
    expect(logger.info).toHaveBeenCalledWith('scheduler: not started', {
      reason: 'SCHEDULER_DISABLED=1',
    });
  });
});

describe('startScheduler ticking', () => {
  it('runs each job on its interval', async () => {
    const { job, calls, finish } = controllableJob('a', 1000);

    startScheduler([job]);
    // The first run is jittered within min(interval, 30s).
    await vi.advanceTimersByTimeAsync(1000);
    finish();
    await vi.advanceTimersByTimeAsync(1000);

    expect(calls.length).toBeGreaterThanOrEqual(1);
  });

  // A slow run must not pile up behind itself — a big outbox backlog would
  // otherwise spawn a new overlapping run every tick.
  it('skips a tick while the previous run is still in flight', async () => {
    const { job, calls } = controllableJob('slow', 1000);

    startScheduler([job]);
    await vi.advanceTimersByTimeAsync(1000); // first (jittered) run starts, never finishes
    await vi.advanceTimersByTimeAsync(5000); // several intervals elapse

    expect(calls).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'scheduler: skipping tick, previous run still in flight',
      { job: 'slow' },
    );
  });

  it('keeps ticking after a job throws', async () => {
    let attempts = 0;
    const job: ScheduledJob = {
      name: 'flaky',
      intervalMs: 1000,
      run: async () => {
        attempts += 1;
        throw new Error('boom');
      },
    };

    startScheduler([job]);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(attempts).toBeGreaterThan(1);
    expect(logger.error).toHaveBeenCalledWith(
      'scheduler: job failed',
      expect.any(Error),
      { job: 'flaky' },
    );
  });

  // Dev hot-reload re-runs instrumentation; a second timer set would double
  // every job.
  it('is idempotent — a second start adds no extra timers', async () => {
    const { job, calls, finish } = controllableJob('once', 1000);

    startScheduler([job]);
    startScheduler([job]);
    await vi.advanceTimersByTimeAsync(1000);
    finish();

    expect(calls).toHaveLength(1);
  });

  it('stopScheduler halts further ticks', async () => {
    const { job, calls, finish } = controllableJob('stoppable', 1000);

    startScheduler([job]);
    await vi.advanceTimersByTimeAsync(1000);
    finish();
    stopScheduler();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(calls).toHaveLength(1);
  });
});

describe('scheduledJobs', () => {
  it('schedules the outbox every minute and housekeeping less often', () => {
    const jobs = scheduledJobs();
    const outbox = jobs.find((j) => j.name === 'process-outbox');
    const purge = jobs.find((j) => j.name === 'purge-rate-limits');

    expect(outbox?.intervalMs).toBe(60_000);
    expect(purge?.intervalMs).toBeGreaterThan(60_000);
  });

  it('has a unique name per job (names key the logs)', () => {
    const names = scheduledJobs().map((j) => j.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
