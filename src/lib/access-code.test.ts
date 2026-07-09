import { describe, expect, it } from 'vitest';
import {
  ACCESS_CODE_LENGTH,
  generateAccessCode,
  hashAccessCode,
  accessCodeMatches,
  buildAccessCodeCookie,
  isAccessCodeCookieValid,
} from './access-code';

describe('generateAccessCode', () => {
  it('produces a numeric code of the expected length', () => {
    for (let i = 0; i < 20; i++) {
      const code = generateAccessCode();
      expect(code).toMatch(new RegExp(`^\\d{${ACCESS_CODE_LENGTH}}$`));
    }
  });
});

describe('hashAccessCode / accessCodeMatches', () => {
  it('verifies the original code and rejects a different one', async () => {
    const hash = await hashAccessCode('483920');
    expect(hash).not.toContain('483920');
    expect(await accessCodeMatches('483920', hash)).toBe(true);
    expect(await accessCodeMatches('483921', hash)).toBe(false);
  });
});

describe('access-code cookie', () => {
  const access = { id: 'e3b0c442-98fc-4c14-9afb-f4c8996fb924', accessCodeHash: '$2b$12$somestoredhashvalue' };

  it('round-trips: a freshly built cookie validates for the same access row', () => {
    const cookie = buildAccessCodeCookie(access);
    expect(isAccessCodeCookieValid(access, cookie.value)).toBe(true);
  });

  it('rejects a cookie for a different access row', () => {
    const cookie = buildAccessCodeCookie(access);
    const other = { ...access, id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' };
    expect(isAccessCodeCookieValid(other, cookie.value)).toBe(false);
  });

  it('rejects the cookie after the code hash changes (code rotated)', () => {
    const cookie = buildAccessCodeCookie(access);
    const rotated = { ...access, accessCodeHash: '$2b$12$adifferenthashvalue' };
    expect(isAccessCodeCookieValid(rotated, cookie.value)).toBe(false);
  });

  it('rejects tampered values, expired timestamps, and garbage', () => {
    const cookie = buildAccessCodeCookie(access);
    const [id, exp, sig] = cookie.value.split('.');

    // Tampered expiry (extend lifetime) without re-signing
    expect(isAccessCodeCookieValid(access, `${id}.${Number(exp) + 60_000}.${sig}`)).toBe(false);
    // Expired timestamp signed... can't sign ourselves, so just a past exp with the old sig
    expect(isAccessCodeCookieValid(access, `${id}.${Date.now() - 1000}.${sig}`)).toBe(false);
    // Garbage
    expect(isAccessCodeCookieValid(access, 'not-a-cookie')).toBe(false);
    expect(isAccessCodeCookieValid(access, '')).toBe(false);
    expect(isAccessCodeCookieValid(access, null)).toBe(false);
    expect(isAccessCodeCookieValid(access, undefined)).toBe(false);
  });

  it('never validates when the access row has no code set', () => {
    const cookie = buildAccessCodeCookie(access);
    expect(isAccessCodeCookieValid({ ...access, accessCodeHash: null }, cookie.value)).toBe(false);
  });
});
