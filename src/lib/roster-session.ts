/**
 * Guest session for the short-URL roster page (David, 2026-08-03).
 *
 * After passing the page's gate (its password, or an unguessable token link)
 * and entering an email, the guest holds a signed HttpOnly cookie binding
 * (orderId, guestId, role, gate-state). No server-side session row: the HMAC
 * is the proof, and binding the PASSWORD VALUES into the signature means:
 *  - rotating/removing the page password invalidates every cookie;
 *  - staff resetting the club-admin password invalidates the ADMIN cookie
 *    (their hash is part of the admin gate-state).
 *
 * Role 'admin' is the club admin — the guest whose email matches the order's
 * customer email AND who proved it with their own password.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from './env';

export const ROSTER_SESSION_COOKIE = 'bm-roster';

// A month: team members trickle back over weeks to fix sizes.
const COOKIE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

export type RosterRole = 'guest' | 'admin';

interface OrderGate {
  id: string;
  rosterPassword: string | null;
  rosterAdminPasswordHash: string | null;
}

/** The gate state a cookie was issued under, per role. */
function gateState(order: OrderGate, role: RosterRole): string {
  const page = order.rosterPassword ?? '';
  return role === 'admin' ? `${page}|${order.rosterAdminPasswordHash ?? ''}` : page;
}

function sign(orderId: string, guestId: string, role: RosterRole, gate: string, expiresMs: number): string {
  return createHmac('sha256', env.SESSION_SECRET)
    .update(`roster.${orderId}.${guestId}.${role}.${gate}.${expiresMs}`)
    .digest('hex');
}

export function buildRosterSessionCookie(params: {
  order: OrderGate;
  guestId: string;
  role: RosterRole;
}): { name: string; value: string; maxAgeSeconds: number } {
  const expiresMs = Date.now() + COOKIE_TTL_MS;
  const gate = gateState(params.order, params.role);
  return {
    name: ROSTER_SESSION_COOKIE,
    value: [
      params.order.id,
      params.guestId,
      params.role,
      expiresMs,
      sign(params.order.id, params.guestId, params.role, gate, expiresMs),
    ].join('.'),
    maxAgeSeconds: Math.floor(COOKIE_TTL_MS / 1_000),
  };
}

/** The session the cookie proves for this order, or null. */
export function readRosterSessionCookie(
  order: OrderGate,
  cookieValue: string | null | undefined,
): { guestId: string; role: RosterRole } | null {
  if (!cookieValue) return null;
  const parts = cookieValue.split('.');
  if (parts.length !== 5) return null;

  const [orderId, guestId, role, expiresStr, signature] = parts;
  if (role !== 'guest' && role !== 'admin') return null;
  const expiresMs = Number(expiresStr);
  if (orderId !== order.id || !Number.isFinite(expiresMs) || expiresMs < Date.now()) return null;

  const expected = Buffer.from(sign(orderId, guestId, role, gateState(order, role), expiresMs));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  return { guestId, role };
}
