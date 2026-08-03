/**
 * Guest session for the short-URL roster page (David, 2026-08-03).
 *
 * After passing the page's gate (its password, or an unguessable token link)
 * and entering an email, the guest holds a signed HttpOnly cookie binding
 * (orderId, guestId, gate-state). No server-side session row: the HMAC is the
 * proof, and binding the PASSWORD VALUE into the signature means rotating or
 * removing the password invalidates every outstanding cookie, same trick as
 * the access-code cookie.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from './env';

export const ROSTER_SESSION_COOKIE = 'bm-roster';

// A month: team members trickle back over weeks to fix sizes.
const COOKIE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

/** The gate state a cookie was issued under — '' when the page has no password. */
function gateState(rosterPassword: string | null): string {
  return rosterPassword ?? '';
}

function sign(orderId: string, guestId: string, gate: string, expiresMs: number): string {
  return createHmac('sha256', env.SESSION_SECRET)
    .update(`roster.${orderId}.${guestId}.${gate}.${expiresMs}`)
    .digest('hex');
}

export function buildRosterSessionCookie(params: {
  orderId: string;
  guestId: string;
  rosterPassword: string | null;
}): { name: string; value: string; maxAgeSeconds: number } {
  const expiresMs = Date.now() + COOKIE_TTL_MS;
  const gate = gateState(params.rosterPassword);
  return {
    name: ROSTER_SESSION_COOKIE,
    value: `${params.orderId}.${params.guestId}.${expiresMs}.${sign(params.orderId, params.guestId, gate, expiresMs)}`,
    maxAgeSeconds: Math.floor(COOKIE_TTL_MS / 1_000),
  };
}

/** The guest id the cookie proves for this order, or null. */
export function readRosterSessionCookie(
  order: { id: string; rosterPassword: string | null },
  cookieValue: string | null | undefined,
): string | null {
  if (!cookieValue) return null;
  const parts = cookieValue.split('.');
  if (parts.length !== 4) return null;

  const [orderId, guestId, expiresStr, signature] = parts;
  const expiresMs = Number(expiresStr);
  if (orderId !== order.id || !Number.isFinite(expiresMs) || expiresMs < Date.now()) return null;

  const expected = Buffer.from(sign(orderId, guestId, gateState(order.rosterPassword), expiresMs));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  return guestId;
}
