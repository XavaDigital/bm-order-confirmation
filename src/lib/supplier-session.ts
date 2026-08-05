/**
 * Supplier portal session (David, 2026-08-05).
 *
 * A supplier "logs in" at /supplier/{CODE} with the supplier's shared portal
 * password (admin-set, stored readably on the supplier row) and their own
 * NAME — no accounts. The name is deliberately self-asserted: David accepts
 * junk names as the cost of a frictionless portal; its only job is to label
 * comments and status changes ("Ana (Dynasty)").
 *
 * The cookie is the roster-session pattern, not iron-session: a signed
 * HttpOnly value binding (supplierId, name, gate-state). Binding the PORTAL
 * PASSWORD into the signature means changing the password signs every holder
 * out. Long TTL — suppliers come back weekly for months.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from './env';

export const SUPPLIER_SESSION_COOKIE = 'bm-supplier';

// Six months: a standing production relationship, not a one-off visit.
const COOKIE_TTL_MS = 180 * 24 * 60 * 60 * 1_000;

interface SupplierGate {
  id: string;
  portalPassword: string | null;
}

function sign(supplierId: string, name: string, gate: string, expiresMs: number): string {
  return createHmac('sha256', env.SESSION_SECRET)
    .update(`supplier.${supplierId}.${name}.${gate}.${expiresMs}`)
    .digest('hex');
}

/** Cookie value parts are dot-joined; the name is base64url so it can hold anything. */
function encodeName(name: string): string {
  return Buffer.from(name, 'utf8').toString('base64url');
}
function decodeName(encoded: string): string | null {
  try {
    return Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

export function buildSupplierSessionCookie(params: {
  supplier: SupplierGate;
  name: string;
}): { name: string; value: string; maxAgeSeconds: number } {
  const expiresMs = Date.now() + COOKIE_TTL_MS;
  const gate = params.supplier.portalPassword ?? '';
  const encodedName = encodeName(params.name);
  return {
    name: SUPPLIER_SESSION_COOKIE,
    value: [
      params.supplier.id,
      encodedName,
      expiresMs,
      sign(params.supplier.id, encodedName, gate, expiresMs),
    ].join('.'),
    maxAgeSeconds: Math.floor(COOKIE_TTL_MS / 1_000),
  };
}

/**
 * The session the cookie proves for this supplier, or null. A null
 * portalPassword means the portal is CLOSED for the supplier — no cookie can
 * verify against it because issuing requires a password match first, and the
 * caller must refuse before ever getting here; the gate-state binding also
 * invalidates any cookie issued before the password was cleared.
 */
export function readSupplierSessionCookie(
  supplier: SupplierGate,
  cookieValue: string | null | undefined,
): { name: string } | null {
  if (!cookieValue) return null;
  const parts = cookieValue.split('.');
  if (parts.length !== 4) return null;

  const [supplierId, encodedName, expiresStr, signature] = parts;
  const expiresMs = Number(expiresStr);
  if (supplierId !== supplier.id || !Number.isFinite(expiresMs) || expiresMs < Date.now()) {
    return null;
  }

  const gate = supplier.portalPassword ?? '';
  const expected = Buffer.from(sign(supplierId, encodedName, gate, expiresMs));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

  const name = decodeName(encodedName);
  if (!name || !name.trim()) return null;
  return { name: name.trim() };
}
