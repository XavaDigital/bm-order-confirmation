import { describe, expect, it } from 'vitest';
import { safeNextPath } from './post-auth-redirect';

const DASHBOARD = '/admin/dashboard';

describe('safeNextPath', () => {
  it('keeps an in-app path', () => {
    expect(safeNextPath('/admin/orders')).toBe('/admin/orders');
  });

  it('keeps a path with a query string', () => {
    expect(safeNextPath('/admin/orders?status=confirmed')).toBe('/admin/orders?status=confirmed');
  });

  it.each([undefined, null, ''])('falls back to the dashboard for %p', (value) => {
    expect(safeNextPath(value)).toBe(DASHBOARD);
  });

  /**
   * `from` is attacker-chosen — it arrives in the query string of a link
   * anyone can send. Since sign-in now navigates with a real document load,
   * an off-site value would be a working open redirect, so these are the
   * cases that matter most.
   */
  it.each([
    '//evil.example',
    '//evil.example/path',
    'https://evil.example',
    'http://evil.example',
    'javascript:alert(1)',
    'evil.example',
    '\\\\evil.example',
  ])('refuses the off-site target %p', (value) => {
    expect(safeNextPath(value)).toBe(DASHBOARD);
  });

  // The one that a naive startsWith('/') check lets through.
  it('refuses a protocol-relative URL specifically', () => {
    expect(safeNextPath('//evil.example')).not.toContain('evil');
  });
});
