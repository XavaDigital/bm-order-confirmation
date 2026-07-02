import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Use vi.stubEnv (not `process.env = ...`) so we only touch the specific keys
// under test and vi.unstubAllEnvs() restores them — `process.env` is a single
// object shared by the whole Node process, and other integration test files
// (spinning up their own PGlite instances) run concurrently in the same
// process, so replacing the object wholesale corrupts their environment too.
describe('env', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('throws when required vars are missing at runtime (not a `next build`)', async () => {
    vi.stubEnv('TOKEN_PEPPER', '');
    vi.stubEnv('NEXT_PHASE', '');

    await expect(import('./env')).rejects.toThrow(/TOKEN_PEPPER/);
  });

  it('does not throw during `next build` even if required vars are missing', async () => {
    vi.stubEnv('TOKEN_PEPPER', '');
    vi.stubEnv('NEXT_PHASE', 'phase-production-build');

    const { env } = await import('./env');
    expect(env).toBeDefined();
  });

  it('does not throw when all required vars are present', async () => {
    const { env } = await import('./env');
    expect(env.TOKEN_PEPPER).toBe(process.env.TOKEN_PEPPER);
  });
});
