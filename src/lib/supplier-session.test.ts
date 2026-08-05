import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./env', () => ({
  env: { SESSION_SECRET: 'test-session-secret-at-least-32-characters-long' },
}));

import {
  SUPPLIER_SESSION_COOKIE,
  buildSupplierSessionCookie,
  readSupplierSessionCookie,
} from './supplier-session';

const SUPPLIER = { id: '11111111-1111-4111-8111-111111111111', portalPassword: 'fish-tuesday' };

afterEach(() => {
  vi.useRealTimers();
});

describe('buildSupplierSessionCookie', () => {
  it('issues the named cookie with a ~6-month max age', () => {
    const cookie = buildSupplierSessionCookie({ supplier: SUPPLIER, name: 'Ana' });
    expect(cookie.name).toBe(SUPPLIER_SESSION_COOKIE);
    expect(cookie.maxAgeSeconds).toBe(180 * 24 * 60 * 60);
    // supplierId . base64url(name) . expiry . signature
    expect(cookie.value.split('.')).toHaveLength(4);
    expect(cookie.value.startsWith(`${SUPPLIER.id}.`)).toBe(true);
  });
});

describe('readSupplierSessionCookie', () => {
  it('round-trips: a freshly built cookie verifies and returns the name', () => {
    const cookie = buildSupplierSessionCookie({ supplier: SUPPLIER, name: 'Ana' });
    expect(readSupplierSessionCookie(SUPPLIER, cookie.value)).toEqual({ name: 'Ana' });
  });

  it('survives base64url encoding for names with dots, spaces, and unicode', () => {
    // Dots matter most: the cookie itself is dot-joined, so an unencoded name
    // would shift the part boundaries.
    for (const name of ['Ana B. da Silva', '张伟', 'Zoë O\'Brien-Møller', 'a.b.c.d']) {
      const cookie = buildSupplierSessionCookie({ supplier: SUPPLIER, name });
      expect(readSupplierSessionCookie(SUPPLIER, cookie.value)).toEqual({ name });
    }
  });

  it('rejects an expired cookie', () => {
    const cookie = buildSupplierSessionCookie({ supplier: SUPPLIER, name: 'Ana' });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 181 * 24 * 60 * 60 * 1_000);
    expect(readSupplierSessionCookie(SUPPLIER, cookie.value)).toBeNull();
  });

  it('is invalidated by a portal-password rotation (gate-state binding)', () => {
    const cookie = buildSupplierSessionCookie({ supplier: SUPPLIER, name: 'Ana' });
    expect(
      readSupplierSessionCookie({ ...SUPPLIER, portalPassword: 'new-password' }, cookie.value),
    ).toBeNull();
    // Clearing the password (closing the portal) also signs everyone out.
    expect(
      readSupplierSessionCookie({ ...SUPPLIER, portalPassword: null }, cookie.value),
    ).toBeNull();
  });

  it('rejects a tampered signature and a tampered payload', () => {
    const cookie = buildSupplierSessionCookie({ supplier: SUPPLIER, name: 'Ana' });
    const [id, encodedName, expiry, signature] = cookie.value.split('.');

    const flipped = signature.endsWith('0') ? `${signature.slice(0, -1)}1` : `${signature.slice(0, -1)}0`;
    expect(readSupplierSessionCookie(SUPPLIER, [id, encodedName, expiry, flipped].join('.'))).toBeNull();

    // Re-signing is impossible without the secret, so changing any signed part fails.
    const otherName = Buffer.from('Mallory', 'utf8').toString('base64url');
    expect(readSupplierSessionCookie(SUPPLIER, [id, otherName, expiry, signature].join('.'))).toBeNull();
    const laterExpiry = String(Number(expiry) + 1_000);
    expect(readSupplierSessionCookie(SUPPLIER, [id, encodedName, laterExpiry, signature].join('.'))).toBeNull();
  });

  it('rejects a cookie issued for a different supplier', () => {
    const other = { id: '22222222-2222-4222-8222-222222222222', portalPassword: 'fish-tuesday' };
    const cookie = buildSupplierSessionCookie({ supplier: other, name: 'Ana' });
    expect(readSupplierSessionCookie(SUPPLIER, cookie.value)).toBeNull();
  });

  it('rejects missing or malformed cookie values', () => {
    expect(readSupplierSessionCookie(SUPPLIER, null)).toBeNull();
    expect(readSupplierSessionCookie(SUPPLIER, undefined)).toBeNull();
    expect(readSupplierSessionCookie(SUPPLIER, '')).toBeNull();
    expect(readSupplierSessionCookie(SUPPLIER, 'not-a-cookie')).toBeNull();
    expect(readSupplierSessionCookie(SUPPLIER, 'a.b.c')).toBeNull();
    expect(readSupplierSessionCookie(SUPPLIER, 'a.b.c.d.e')).toBeNull();
    expect(readSupplierSessionCookie(SUPPLIER, `${SUPPLIER.id}.name.not-a-number.sig`)).toBeNull();
  });

  it('rejects a cookie whose decoded name is blank', () => {
    const cookie = buildSupplierSessionCookie({ supplier: SUPPLIER, name: '   ' });
    expect(readSupplierSessionCookie(SUPPLIER, cookie.value)).toBeNull();
  });
});
