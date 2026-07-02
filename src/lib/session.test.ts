/**
 * getSession() itself calls next/headers' cookies(), which throws
 * "called outside a request scope" when invoked outside an actual Next.js
 * App Router request (confirmed by experiment — there is no way around this
 * in a plain Vitest test). So the only mocked boundary here is next/headers'
 * cookies(); everything below it — getIronSession, real encryption/decryption
 * via the real SESSION_SECRET from .env.test — runs for real.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

function createCookieStore() {
  const store = new Map<string, string>();
  return {
    get(name: string) {
      return store.has(name) ? { name, value: store.get(name)! } : undefined;
    },
    set(name: string, value: string) {
      store.set(name, value);
    },
    delete(name: string) {
      store.delete(name);
    },
    has(name: string) {
      return store.has(name);
    },
  };
}

let cookieStore = createCookieStore();

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => cookieStore),
}));

import { getSession } from './session';

afterEach(() => {
  cookieStore = createCookieStore();
});

describe('getSession', () => {
  it('starts empty when there is no existing cookie', async () => {
    const session = await getSession();
    expect(session.userId).toBeUndefined();
  });

  it('persists data across calls once saved, via a real encrypted cookie', async () => {
    const session = await getSession();
    session.userId = 'staff-1';
    session.email = 'staff@example.com';
    session.name = 'Staff One';
    session.role = 'admin';
    await session.save();

    expect(cookieStore.has('bm-session')).toBe(true);

    const reloaded = await getSession();
    expect(reloaded.userId).toBe('staff-1');
    expect(reloaded.email).toBe('staff@example.com');
    expect(reloaded.name).toBe('Staff One');
    expect(reloaded.role).toBe('admin');
  });

  it('clears the session on destroy()', async () => {
    const session = await getSession();
    session.userId = 'staff-1';
    await session.save();

    const toDestroy = await getSession();
    toDestroy.destroy();

    const reloaded = await getSession();
    expect(reloaded.userId).toBeUndefined();
  });
});
