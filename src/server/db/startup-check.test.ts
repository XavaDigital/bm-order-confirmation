import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./migration-status', () => ({ getMigrationStatus: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { getMigrationStatus } from './migration-status';
import { logger } from '@/lib/logger';
import { assertMigrationsApplied } from './startup-check';

let exitSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.mocked(getMigrationStatus).mockReset();
  vi.mocked(logger.warn).mockReset();
  vi.mocked(logger.error).mockReset();
  vi.stubEnv('SKIP_MIGRATION_CHECK', '');
  // process.exit would tear the test runner down.
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  exitSpy.mockRestore();
  errorSpy.mockRestore();
  vi.unstubAllEnvs();
});

// stubEnv rather than defineProperty: process.env rejects a partial descriptor.
function setProduction() {
  vi.stubEnv('NODE_ENV', 'production');
}

describe('assertMigrationsApplied — refusing to serve', () => {
  it('exits when migrations are pending in production', async () => {
    setProduction();
    vi.mocked(getMigrationStatus).mockResolvedValue({
      expected: ['0001_a', '0002_b', '0003_c'],
      appliedCount: 1,
      pending: ['0002_b', '0003_c'],
    });

    await assertMigrationsApplied();

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  /**
   * Visibility is the whole point of refusing this way — a container that dies
   * silently is worse than one that serves badly. The pending tags and the fix
   * must both be in the raw output, not only in a structured log the aggregator
   * may or may not surface.
   */
  it('names the pending migrations and the command that fixes it', async () => {
    setProduction();
    vi.mocked(getMigrationStatus).mockResolvedValue({
      expected: ['0026_x', '0027_nosy_cammi'],
      appliedCount: 1,
      pending: ['0027_nosy_cammi'],
    });

    await assertMigrationsApplied();

    const printed = errorSpy.mock.calls.flat().join('\n');
    expect(printed).toContain('STARTUP REFUSED');
    expect(printed).toContain('0027_nosy_cammi');
    expect(printed).toContain('npm run db:migrate');
    expect(printed).toContain('SKIP_MIGRATION_CHECK=1');
  });

  it('also records it through the logger, for the aggregator', async () => {
    setProduction();
    vi.mocked(getMigrationStatus).mockResolvedValue({
      expected: ['0001_a', '0002_b'],
      appliedCount: 1,
      pending: ['0002_b'],
    });

    await assertMigrationsApplied();

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('refusing to serve'),
      expect.objectContaining({ pending: ['0002_b'] }),
    );
  });
});

describe('assertMigrationsApplied — when it must NOT refuse', () => {
  /**
   * The asymmetry that keeps this from becoming its own outage: a database that
   * cannot be reached during a deploy is UNKNOWN, not behind. Refusing on
   * unknown would turn a network blip into downtime — worse than the problem
   * being prevented.
   */
  it('starts anyway when the status cannot be determined', async () => {
    setProduction();
    vi.mocked(getMigrationStatus).mockResolvedValue(null);

    await assertMigrationsApplied();

    expect(exitSpy).not.toHaveBeenCalled();
    // But it must SAY so — a silent skip is how the gate stops protecting.
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('could not verify'));
  });

  it('starts when everything is applied', async () => {
    setProduction();
    vi.mocked(getMigrationStatus).mockResolvedValue({
      expected: ['0001_a'],
      appliedCount: 1,
      pending: [],
    });

    await assertMigrationsApplied();

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('starts when more migrations are applied than are on disk', async () => {
    // Rolling back a deploy leaves the database AHEAD of the code. That is the
    // safe direction — the old build simply does not use the new columns.
    setProduction();
    vi.mocked(getMigrationStatus).mockResolvedValue({
      expected: ['0001_a'],
      appliedCount: 5,
      pending: [],
    });

    await assertMigrationsApplied();

    expect(exitSpy).not.toHaveBeenCalled();
  });

  // A developer who has just written a migration should be told, not blocked.
  it('does not block outside production', async () => {
    vi.mocked(getMigrationStatus).mockResolvedValue({
      expected: ['0001_a', '0002_b'],
      appliedCount: 1,
      pending: ['0002_b'],
    });

    await assertMigrationsApplied();

    expect(exitSpy).not.toHaveBeenCalled();
    expect(errorSpy.mock.calls.flat().join('\n')).toContain('starting anyway');
  });

  // A gate with no escape hatch becomes the incident during the incident.
  it('honours the escape hatch', async () => {
    setProduction();
    vi.stubEnv('SKIP_MIGRATION_CHECK', '1');

    await assertMigrationsApplied();

    expect(exitSpy).not.toHaveBeenCalled();
    expect(getMigrationStatus).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('skipped'));
  });
});
