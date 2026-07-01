import { describe, it, expect } from 'vitest';
import { generateSync } from 'otplib';
import {
  generateTotpSecret,
  generateTotpUri,
  verifyTotp,
  generateBackupCodes,
  hashBackupCode,
  consumeBackupCode,
} from './totp';

describe('generateTotpSecret', () => {
  it('returns a non-empty base32 secret and differs between calls', () => {
    const a = generateTotpSecret();
    const b = generateTotpSecret();
    expect(a.length).toBeGreaterThan(0);
    expect(a).toMatch(/^[A-Z2-7]+$/);
    expect(a).not.toBe(b);
  });
});

describe('generateTotpUri', () => {
  it('produces an otpauth:// URI with the BeastMode issuer and the email label', () => {
    const secret = generateTotpSecret();
    const uri = generateTotpUri(secret, 'staff@example.com');
    expect(uri).toMatch(/^otpauth:\/\//);
    expect(uri).toContain('BeastMode%20Portal');
    expect(uri).toContain(encodeURIComponent('staff@example.com'));
  });
});

describe('verifyTotp', () => {
  it('accepts a code freshly generated from the same secret', () => {
    const secret = generateTotpSecret();
    const code = generateSync({ secret });
    expect(verifyTotp(code, secret)).toBe(true);
  });

  it('rejects a wrong code', () => {
    const secret = generateTotpSecret();
    expect(verifyTotp('000000', secret)).toBe(false);
  });

  it('rejects malformed input without throwing', () => {
    const secret = generateTotpSecret();
    expect(verifyTotp('', secret)).toBe(false);
    expect(verifyTotp('not-numeric', secret)).toBe(false);
  });
});

describe('generateBackupCodes', () => {
  it('generates 8 codes in XXXXX-XXXXX format with matching hashes', () => {
    const { raw, hashed } = generateBackupCodes();
    expect(raw).toHaveLength(8);
    expect(hashed).toHaveLength(8);
    for (const code of raw) {
      expect(code).toMatch(/^[0-9A-F]{5}-[0-9A-F]{5}$/);
    }
    raw.forEach((code, i) => {
      expect(hashed[i]).toBe(hashBackupCode(code));
    });
  });

  it('generates different codes on each call', () => {
    const first = generateBackupCodes();
    const second = generateBackupCodes();
    expect(first.raw).not.toEqual(second.raw);
  });
});

describe('hashBackupCode', () => {
  it('normalises case and dashes so equivalent codes hash the same', () => {
    expect(hashBackupCode('ab12c-3de45')).toBe(hashBackupCode('AB12C3DE45'));
  });

  it('produces different hashes for different codes', () => {
    expect(hashBackupCode('AAAAA-AAAAA')).not.toBe(hashBackupCode('BBBBB-BBBBB'));
  });
});

describe('consumeBackupCode', () => {
  it('removes the matching code and returns the remaining list', () => {
    const { raw, hashed } = generateBackupCodes();
    const result = consumeBackupCode(raw[3], hashed);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(7);
    expect(result).not.toContain(hashed[3]);
  });

  it('returns null and leaves the input untouched when the code is not found', () => {
    const { hashed } = generateBackupCodes();
    const original = [...hashed];
    const result = consumeBackupCode('ZZZZZ-ZZZZZ', hashed);
    expect(result).toBeNull();
    expect(hashed).toEqual(original);
  });
});
