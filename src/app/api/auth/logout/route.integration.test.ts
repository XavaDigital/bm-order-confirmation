import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/session', () => {
  const store: Record<string, unknown> = {};
  const session = new Proxy(store, {
    get(target, prop) {
      if (prop === 'save') return async () => {};
      if (prop === 'destroy') return vi.fn(() => { for (const k of Object.keys(target)) delete target[k]; });
      return target[prop as string];
    },
    set(target, prop, value) {
      target[prop as string] = value;
      return true;
    },
  });
  return {
    getSession: vi.fn(async () => session),
    requireAdmin: vi.fn(async () => {
      if (!session.userId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
      if (session.role !== 'admin') return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
      return { session };
    }),
  };
});

import { getSession } from '@/lib/session';
import { POST } from './route';

afterEach(async () => {
  const session = (await getSession()) as unknown as Record<string, unknown>;
  for (const key of Object.keys(session)) delete session[key];
});

describe('POST /api/auth/logout', () => {
  it('returns { ok: true } and destroys the session', async () => {
    const session = (await getSession()) as unknown as Record<string, unknown>;
    session.userId = 'staff-1';
    session.role = 'sales';

    const res = await POST(new NextRequest('http://localhost/api/auth/logout', { method: 'POST' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });

    const after = (await getSession()) as unknown as Record<string, unknown>;
    expect(after.userId).toBeUndefined();
  });
});
