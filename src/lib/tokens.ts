/**
 * Customer magic-link token utilities (PROJECT_BRIEF.md §7).
 *
 * The token is high-entropy (32 random bytes), so a fast deterministic hash
 * (SHA-256 + server pepper) is the right choice: it lets us look up an order by
 * hashing the incoming token, while a DB leak never exposes a live link.
 *
 * The optional per-order confirmation code is LOW entropy, so when that feature
 * is used it should be hashed with a slow KDF (bcrypt/argon2) instead — added
 * when the feature is implemented.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from './env';

export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256')
    .update(`${token}${env.TOKEN_PEPPER}`)
    .digest('hex');
}

export function tokensMatch(rawToken: string, storedHash: string): boolean {
  const a = Buffer.from(hashToken(rawToken));
  const b = Buffer.from(storedHash);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Build the full shareable customer URL for a raw token. */
export function buildConfirmationUrl(rawToken: string): string {
  return `${env.APP_BASE_URL.replace(/\/$/, '')}/o/${rawToken}`;
}

/** Build the full shareable team-roster URL for a raw roster token. */
export function buildRosterUrl(rawToken: string): string {
  return `${env.APP_BASE_URL.replace(/\/$/, '')}/o/roster/${rawToken}`;
}

/** Build the full shareable single-member roster URL for a raw member token. */
export function buildMemberRosterUrl(rawToken: string): string {
  return `${env.APP_BASE_URL.replace(/\/$/, '')}/o/roster/member/${rawToken}`;
}

/** Build the full shareable supplier-portal URL for a raw PO supplier token. */
export function buildSupplierPortalUrl(rawToken: string): string {
  return `${env.APP_BASE_URL.replace(/\/$/, '')}/s/${rawToken}`;
}

/**
 * The PRETTY per-PO portal URL (David, 2026-08-05; path shape revised
 * 2026-08-05: /supplier/{CODE}/po/{PO#}): known the moment the PO is raised,
 * because the code and number ARE the path. Access is gated by the supplier's
 * portal password, not by the URL being secret. The old /supplier/po/{PO#}
 * form 308-redirects here.
 */
export function buildSupplierPoUrl(supplierCode: string, poNumber: string): string {
  const base = env.APP_BASE_URL.replace(/\/$/, '');
  return `${base}/supplier/${encodeURIComponent(supplierCode)}/po/${encodeURIComponent(poNumber)}`;
}

/** The supplier's portal home — their filterable PO table. */
export function buildSupplierPortalHomeUrl(supplierCode: string): string {
  return `${env.APP_BASE_URL.replace(/\/$/, '')}/supplier/${encodeURIComponent(supplierCode)}`;
}
