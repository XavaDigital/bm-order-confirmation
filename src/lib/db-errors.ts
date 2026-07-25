/**
 * Postgres error helpers — driver-agnostic (postgres-js and PGlite both
 * surface the SQLSTATE on `code` and the constraint name on
 * `constraint_name`/`constraint`).
 */

/** True when `err` is a unique-constraint violation (optionally a specific constraint). */
export function isUniqueViolation(err: unknown, constraintName?: string): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; constraint_name?: string; constraint?: string };
  if (e.code !== '23505') return false;
  if (!constraintName) return true;
  return e.constraint_name === constraintName || e.constraint === constraintName;
}
