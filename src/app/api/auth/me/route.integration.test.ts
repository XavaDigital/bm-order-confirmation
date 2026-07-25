import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/session', () => {
  const store: Record<string, unknown> = {};
  const session = new Proxy(store, {
    get(target, prop) {
      if (prop === 'save') return async () => {};
      if (prop === 'destroy') return () => { for (const k of Object.keys(target)) delete target[k]; };
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
import { GET } from './route';

afterEach(async () => {
  const session = (await getSession()) as unknown as Record<string, unknown>;
  for (const key of Object.keys(session)) delete session[key];
});

describe('GET /api/auth/me', () => {
  it('returns 401 when there is no session', async () => {
    const res = await GET(new NextRequest('http://localhost/api/auth/me'));
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toBe('Unauthenticated');
  });

  it('returns 200 with the session user shape', async () => {
    const session = (await getSession()) as unknown as Record<string, unknown>;
    session.userId = 'staff-1';
    session.email = 'staff@example.com';
    session.name = 'Staff One';
    session.role = 'sales';

    const res = await GET(new NextRequest('http://localhost/api/auth/me'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      user: { id: 'staff-1', email: 'staff@example.com', name: 'Staff One', role: 'sales' },
    });
  });
});
