import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';

vi.mock('@/db', async () => {
  const { createTestDb } = await import('@/db/test-helpers');
  const schema = await import('@/db/schema');
  const { db } = await createTestDb();
  return { db, schema };
});

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
import { getSession } from '@/lib/session';
import { hashPassword } from '@/lib/password';
import { POST } from './route';

afterEach(async () => {
  await resetTestDb(db);
  const session = (await getSession()) as unknown as Record<string, unknown>;
  for (const key of Object.keys(session)) delete session[key];
});

async function seedStaff(overrides: Partial<typeof schema.staffUsers.$inferInsert> = {}) {
  const passwordHash = await hashPassword('correct-horse');
  const [staff] = await db
    .insert(schema.staffUsers)
    .values({
      email: 'setup@example.com',
      passwordHash,
      name: 'Setup Staff',
      ...overrides,
    })
    .returning();
  return staff;
}

async function setSession(userId: string, email: string) {
  const session = (await getSession()) as unknown as Record<string, unknown>;
  session.userId = userId;
  session.email = email;
}

function setupRequest(body: unknown) {
  return new NextRequest('http://localhost/api/admin/auth/2fa/setup', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function setupRequestRaw(rawBody: string) {
  return new NextRequest('http://localhost/api/admin/auth/2fa/setup', {
    method: 'POST',
    body: rawBody,
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/admin/auth/2fa/setup', () => {
  it('returns 401 when there is no session', async () => {
    const res = await POST(setupRequest({ password: 'correct-horse' }));
    expect(res.status).toBe(401);
  });

  it('returns 400 when the password field is missing', async () => {
    const staff = await seedStaff();
    await setSession(staff.id, staff.email);
    const res = await POST(setupRequest({}));
    expect(res.status).toBe(400);
  });

  it('returns 400 for a request body that is not valid JSON', async () => {
    const staff = await seedStaff();
    await setSession(staff.id, staff.email);
    const res = await POST(setupRequestRaw('not-json{{'));
    expect(res.status).toBe(400);
  });

  it('returns 401 for an incorrect password', async () => {
    const staff = await seedStaff();
    await setSession(staff.id, staff.email);
    const res = await POST(setupRequest({ password: 'wrong' }));
    expect(res.status).toBe(401);
  });

  it('returns 400 when 2FA is already enabled', async () => {
    const staff = await seedStaff({ totpEnabled: true, totpSecret: 'ABC' });
    await setSession(staff.id, staff.email);
    const res = await POST(setupRequest({ password: 'correct-horse' }));
    expect(res.status).toBe(400);
  });

  it('generates and persists a pending secret without enabling 2FA', async () => {
    const staff = await seedStaff();
    await setSession(staff.id, staff.email);

    const res = await POST(setupRequest({ password: 'correct-horse' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.secret).toBe('string');
    expect(body.secret.length).toBeGreaterThan(0);
    expect(body.qrDataUrl).toMatch(/^data:image\/png;base64,/);

    const [updated] = await db
      .select()
      .from(schema.staffUsers)
      .where(eq(schema.staffUsers.id, staff.id));
    expect(updated.totpSecret).toBe(body.secret);
    expect(updated.totpEnabled).toBe(false);
  });
});
