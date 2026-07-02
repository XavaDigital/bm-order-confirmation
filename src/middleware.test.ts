import { describe, expect, it } from 'vitest';
import { sealData } from 'iron-session';
import { NextRequest } from 'next/server';
import { sessionOptions, type SessionData } from '@/lib/session';
import { middleware } from './middleware';

async function requestWithSession(
  url: string,
  session?: Partial<SessionData>,
): Promise<NextRequest> {
  const headers = new Headers();
  if (session) {
    const sealed = await sealData(session, sessionOptions);
    headers.set('cookie', `${sessionOptions.cookieName}=${sealed}`);
  }
  return new NextRequest(new Request(url, { headers }));
}

describe('middleware', () => {
  it('sets X-Robots-Tag on a public path and does not redirect', async () => {
    const res = await middleware(await requestWithSession('http://localhost/o/some-token'));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow, noarchive');
    expect(res.headers.get('location')).toBeNull();
  });

  it('lets the public /api/orders and /api/health routes through without a session', async () => {
    const orders = await middleware(await requestWithSession('http://localhost/api/orders'));
    expect(orders.headers.get('location')).toBeNull();
    const health = await middleware(await requestWithSession('http://localhost/api/health'));
    expect(health.headers.get('location')).toBeNull();
  });

  it('redirects unauthenticated /admin/** requests to /login with a "from" param', async () => {
    const res = await middleware(
      await requestWithSession('http://localhost/admin/dashboard'),
    );
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('from')).toBe('/admin/dashboard');
  });

  it('returns 401 JSON for unauthenticated /api/admin/** requests', async () => {
    const res = await middleware(
      await requestWithSession('http://localhost/api/admin/orders'),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('redirects to /login/2fa when the session has mfaPending', async () => {
    const res = await middleware(
      await requestWithSession('http://localhost/admin/dashboard', {
        userId: 'u1',
        email: 'a@example.com',
        name: 'A',
        role: 'sales',
        mfaPending: true,
      }),
    );
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login/2fa');
  });

  it('allows a fully authenticated session through to /admin/**', async () => {
    const res = await middleware(
      await requestWithSession('http://localhost/admin/dashboard', {
        userId: 'u1',
        email: 'a@example.com',
        name: 'A',
        role: 'sales',
        mfaPending: false,
      }),
    );
    expect(res.headers.get('location')).toBeNull();
    expect(res.status).toBe(200);
  });

  it('allows a fully authenticated session through to /api/admin/**', async () => {
    const res = await middleware(
      await requestWithSession('http://localhost/api/admin/orders', {
        userId: 'u1',
        email: 'a@example.com',
        name: 'A',
        role: 'admin',
        mfaPending: false,
      }),
    );
    expect(res.headers.get('location')).toBeNull();
    expect(res.status).toBe(200);
  });

  describe('/login/2fa', () => {
    it('redirects to /login when there is no session at all', async () => {
      const res = await middleware(await requestWithSession('http://localhost/login/2fa'));
      expect(new URL(res.headers.get('location')!).pathname).toBe('/login');
    });

    it('redirects fully authed users to /admin/dashboard', async () => {
      const res = await middleware(
        await requestWithSession('http://localhost/login/2fa', {
          userId: 'u1',
          email: 'a@example.com',
          name: 'A',
          role: 'sales',
          mfaPending: false,
        }),
      );
      expect(new URL(res.headers.get('location')!).pathname).toBe('/admin/dashboard');
    });

    it('lets a user with a pending MFA session through', async () => {
      const res = await middleware(
        await requestWithSession('http://localhost/login/2fa', {
          userId: 'u1',
          email: 'a@example.com',
          name: 'A',
          role: 'sales',
          mfaPending: true,
        }),
      );
      expect(res.headers.get('location')).toBeNull();
      expect(res.status).toBe(200);
    });
  });

  describe('/login', () => {
    it('lets an unauthenticated visitor through', async () => {
      const res = await middleware(await requestWithSession('http://localhost/login'));
      expect(res.headers.get('location')).toBeNull();
    });

    it('redirects a fully authenticated user away to /admin/dashboard', async () => {
      const res = await middleware(
        await requestWithSession('http://localhost/login', {
          userId: 'u1',
          email: 'a@example.com',
          name: 'A',
          role: 'sales',
          mfaPending: false,
        }),
      );
      expect(new URL(res.headers.get('location')!).pathname).toBe('/admin/dashboard');
    });

    it('does not redirect a user still awaiting MFA', async () => {
      const res = await middleware(
        await requestWithSession('http://localhost/login', {
          userId: 'u1',
          email: 'a@example.com',
          name: 'A',
          role: 'sales',
          mfaPending: true,
        }),
      );
      expect(res.headers.get('location')).toBeNull();
    });
  });
});
