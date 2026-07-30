/**
 * Startup gate: refuse to serve a build whose migrations have not been applied.
 *
 * Cloud Run makes this the RIGHT failure. A container that exits on start never
 * passes its health check, so the revision is never given traffic and the
 * previous good revision keeps serving. The deploy fails instead of the app
 * breaking — which is the outcome we wanted on 2026-07-30 and did not get.
 *
 * Deliberately narrow:
 *   - only when the status is KNOWN and pending (see getMigrationStatus for why
 *     an unreachable database must not stop startup);
 *   - only in production, so a developer mid-migration is not locked out;
 *   - skippable via SKIP_MIGRATION_CHECK, because a gate with no escape hatch
 *     becomes the incident during the incident.
 */
import { logger } from '@/lib/logger';
import { getMigrationStatus } from './migration-status';

/** Loud enough to be the first thing anyone reads in the logs. */
function report(lines: string[]): void {
  const banner = '='.repeat(72);
  // console.error directly, not the logger: this has to survive whatever
  // transport the logger is configured with and be legible in raw Cloud Run
  // logs, where a JSON blob is exactly what nobody can read at 2am.
  console.error(`\n${banner}`);
  for (const line of lines) console.error(line);
  console.error(`${banner}\n`);
}

export async function assertMigrationsApplied(): Promise<void> {
  if (process.env.SKIP_MIGRATION_CHECK === '1') {
    logger.warn('[startup] migration check skipped via SKIP_MIGRATION_CHECK');
    return;
  }

  const status = await getMigrationStatus();

  if (status === null) {
    // Unknown, not fine. Say so — a silent skip here is how the gate quietly
    // stops protecting anything.
    logger.warn(
      '[startup] could not verify migrations (no drizzle journal, no migrations table, or the database was unreachable). Starting anyway.',
    );
    return;
  }

  if (status.pending.length === 0) {
    logger.info('[startup] migrations up to date', { applied: status.appliedCount });
    return;
  }

  const lines = [
    `STARTUP REFUSED: ${status.pending.length} migration(s) are not applied to this database.`,
    '',
    `  applied:  ${status.appliedCount}`,
    `  on disk:  ${status.expected.length}`,
    '',
    '  pending (in the order they must run):',
    ...status.pending.map((tag) => `    - ${tag}`),
    '',
    '  This build declares columns the database does not have, so it would throw',
    '  on every query touching those tables — while /login and /api/health kept',
    '  returning 200. Refusing to serve is the safer failure.',
    '',
    '  Fix:  npm run db:migrate    then redeploy',
    '',
    '  To start anyway (and accept the breakage): SKIP_MIGRATION_CHECK=1',
  ];

  if (process.env.NODE_ENV !== 'production') {
    // A developer who has just written a migration should be told, not blocked.
    report([...lines.slice(0, -3), '  Not production — starting anyway.']);
    return;
  }

  report(lines);
  logger.error('[startup] refusing to serve with pending migrations', {
    pending: status.pending,
    appliedCount: status.appliedCount,
    expectedCount: status.expected.length,
  });

  // Exit rather than throw: an exception here can be swallowed by the framework
  // and leave the process half-started, serving requests it should not.
  process.exit(1);
}
