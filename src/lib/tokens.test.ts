import { describe, it, expect, vi } from 'vitest';
import { generateToken, hashToken, tokensMatch, buildConfirmationUrl, buildRosterUrl } from './tokens';

vi.mock('./env', () => ({
  env: { APP_BASE_URL: 'http://localhost:3000/', TOKEN_PEPPER: 'test-pepper' },
}));

describe('generateToken', () => {
  it('returns a base64url string of the expected length', () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    // 32 random bytes -> 43 base64url chars (no padding)
    expect(token.length).toBe(43);
  });

  it('returns a different value on each call', () => {
    expect(generateToken()).not.toBe(generateToken());
  });
});

describe('hashToken', () => {
  it('is deterministic for the same input', () => {
    const token = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it('produces different hashes for different tokens', () => {
    expect(hashToken('token-a')).not.toBe(hashToken('token-b'));
  });

  it('produces a 64-char hex digest (sha256)', () => {
    expect(hashToken('anything')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('tokensMatch', () => {
  it('returns true when the raw token matches its own hash', () => {
    const token = generateToken();
    expect(tokensMatch(token, hashToken(token))).toBe(true);
  });

  it('returns false for a wrong token', () => {
    const token = generateToken();
    expect(tokensMatch('wrong-token', hashToken(token))).toBe(false);
  });

  it('returns false (not throw) when lengths differ', () => {
    expect(tokensMatch('short', 'not-a-real-hash')).toBe(false);
  });
});

describe('buildConfirmationUrl', () => {
  it('strips a trailing slash from APP_BASE_URL before appending the path', () => {
    // mocked env has a trailing slash on APP_BASE_URL
    expect(buildConfirmationUrl('abc123')).toBe('http://localhost:3000/o/abc123');
  });
});

describe('buildRosterUrl', () => {
  it('strips a trailing slash from APP_BASE_URL before appending the roster path', () => {
    expect(buildRosterUrl('abc123')).toBe('http://localhost:3000/o/roster/abc123');
  });
});
