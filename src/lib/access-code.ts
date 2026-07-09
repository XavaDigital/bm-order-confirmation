/**
 * Optional per-order access code (PROJECT_BRIEF.md §7, second factor for the
 * customer magic link). Staff enable it per order and relay the code
 * out-of-band (phone/text), so possession of the emailed link alone stops
 * being enough to open the order.
 *
 * The code is LOW entropy (6 digits), so unlike the magic-link token it is
 * hashed with bcrypt rather than SHA-256 (see the note in src/lib/tokens.ts).
 * Brute force is additionally rate-limited at the verify route.
 *
 * A successful verification is remembered via a short-lived HMAC-signed
 * cookie bound to both the order_access row id AND the current code hash —
 * revoking the link, regenerating it, or rotating the code all invalidate
 * outstanding cookies without any server-side session state.
 */
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { env } from './env';

export const ACCESS_CODE_COOKIE = 'bm-oc-verified';
export const ACCESS_CODE_LENGTH = 6;

const COOKIE_TTL_MS = 12 * 60 * 60 * 1_000; // 12 hours
const BCRYPT_ROUNDS = 12;

export function generateAccessCode(): string {
  return String(randomInt(0, 10 ** ACCESS_CODE_LENGTH)).padStart(ACCESS_CODE_LENGTH, '0');
}

export async function hashAccessCode(code: string): Promise<string> {
  return bcrypt.hash(code, BCRYPT_ROUNDS);
}

export async function accessCodeMatches(code: string, hash: string): Promise<boolean> {
  return bcrypt.compare(code, hash);
}

function sign(accessId: string, codeHash: string, expiresMs: number): string {
  return createHmac('sha256', env.SESSION_SECRET)
    .update(`${accessId}.${codeHash}.${expiresMs}`)
    .digest('hex');
}

/** Cookie payload proving the code was entered for this access row. */
export function buildAccessCodeCookie(access: { id: string; accessCodeHash: string }): {
  name: string;
  value: string;
  maxAgeSeconds: number;
} {
  const expiresMs = Date.now() + COOKIE_TTL_MS;
  return {
    name: ACCESS_CODE_COOKIE,
    value: `${access.id}.${expiresMs}.${sign(access.id, access.accessCodeHash, expiresMs)}`,
    maxAgeSeconds: Math.floor(COOKIE_TTL_MS / 1_000),
  };
}

export function isAccessCodeCookieValid(
  access: { id: string; accessCodeHash: string | null },
  cookieValue: string | null | undefined,
): boolean {
  if (!access.accessCodeHash || !cookieValue) return false;

  const parts = cookieValue.split('.');
  if (parts.length !== 3) return false;

  const [accessId, expiresStr, signature] = parts;
  const expiresMs = Number(expiresStr);
  if (accessId !== access.id || !Number.isFinite(expiresMs) || expiresMs < Date.now()) {
    return false;
  }

  const expected = Buffer.from(sign(access.id, access.accessCodeHash, expiresMs));
  const actual = Buffer.from(signature);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
