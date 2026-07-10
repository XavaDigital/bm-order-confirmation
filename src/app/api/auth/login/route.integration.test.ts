import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/db', async () => {
  const { createTestDb } = await import('@/db/test-helpers');
  const schema = await import('@/db/schema');
  const { db } = await createTestDb();
  return { db, schema };
});

// getSession() calls next/headers' cookies(), which throws outside a real
// Next.js request scope. Replace it with a mutable in-memory session so the
// route's own logic (status codes, session field mutations) is still exercised.
vi.mock('@/lib/session', () => {
  const store: Record<string, unknown> = {};
  const session = new Proxy(store, {
    get(target, prop) {
      if (prop === 'save') return async () => {};
      if (prop === 'destroy') {
        return () => {
          for (const k of Object.keys(target)) delete target[k];
        };
      }
      return target[prop as string];
    },
    set(target, prop, value) {
      target[prop as string] = value;
      return true;
    },
  });
  return { getSession: vi.fn(async () => session) };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { hashPassword } from '@/lib/password';
import { getSession } from '@/lib/session';
import { POST } from './route';

afterEach(async () => {
  await resetTestDb(db);
});

async function seedStaff(overrides: Partial<typeof schema.staffUsers.$inferInsert> = {}) {
  const passwordHash = await hashPassword('correct-horse');
  const [staff] = await db
    .insert(schema.staffUsers)
    .values({
      email: 'staff@example.com',
      passwordHash,
      name: 'Staff',
      isActive: true,
      totpEnabled: false,
      ...overrides,
    })
    .returning();
  return staff;
}

function loginRequest(body: unknown, ip = '10.0.0.1') {
  return new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
  });
}

function loginRequestRaw(rawBody: string, ip = '10.0.0.1') {
  return new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    body: rawBody,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
  });
}

describe('POST /api/auth/login', () => {
  it('returns 400 for a request body that is not valid JSON', async () => {
    const res = await POST(loginRequestRaw('not-json{{'));
    expect(res.status).toBe(400);
  });

  it('returns 400 for a malformed email address', async () => {
    const res = await POST(loginRequest({ email: 'not-an-email', password: 'x' }));
    expect(res.status).toBe(400);
  });

  it('returns 401 for wrong credentials', async () => {
    await seedStaff();
    const res = await POST(loginRequest({ email: 'staff@example.com', password: 'wrong' }));
    expect(res.status).toBe(401);
  });

  it('returns 401 for an unknown email', async () => {
    const res = await POST(loginRequest({ email: 'nobody@example.com', password: 'x' }));
    expect(res.status).toBe(401);
  });

  it('logs in a non-2FA user and sets the session (requiresMfa: false)', async () => {
    const staff = await seedStaff();
    const res = await POST(
      loginRequest({ email: 'staff@example.com', password: 'correct-horse' }, '10.0.0.2'),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requiresMfa).toBe(false);
    expect(body.user).toEqual({ name: 'Staff', email: 'staff@example.com', role: 'sales' });

    const session = await getSession();
    expect((session as unknown as { userId: string }).userId).toBe(staff.id);
    expect((session as unknown as { mfaPending: boolean }).mfaPending).toBe(false);
  });

  it('logs in a 2FA-enabled user with requiresMfa: true and no user field', async () => {
    await seedStaff({ email: 'mfa@example.com', totpEnabled: true, totpSecret: 'ABCDEF' });
    const res = await POST(
      loginRequest({ email: 'mfa@example.com', password: 'correct-horse' }, '10.0.0.3'),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requiresMfa).toBe(true);
    expect(body.user).toBeUndefined();

    const session = await getSession();
    expect((session as unknown as { mfaPending: boolean }).mfaPending).toBe(true);
  });

  it('rate limits after 10 attempts from the same IP', async () => {
    await seedStaff();
    const ip = '10.0.0.99';
    for (let i = 0; i < 10; i++) {
      const res = await POST(loginRequest({ email: 'staff@example.com', password: 'wrong' }, ip));
      expect(res.status).toBe(401);
    }
    const eleventh = await POST(
      loginRequest({ email: 'staff@example.com', password: 'wrong' }, ip),
    );
    expect(eleventh.status).toBe(429);
    expect(eleventh.headers.get('Retry-After')).not.toBeNull();
  });
});
