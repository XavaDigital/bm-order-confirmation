import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';

vi.mock('@/db', async () => {
  const { createTestDb } = await import('@/db/test-helpers');
  const schema = await import('@/db/schema');
  const { db } = await createTestDb();
  return { db, schema };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { inviteUser } from '@/server/users/service';
import { verifyPassword } from '@/lib/password';
import { POST } from './route';

afterEach(async () => {
  await resetTestDb(db);
});

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/auth/accept-invite', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/auth/accept-invite', () => {
  it('returns 400 with details for an invalid body', async () => {
    const res = await POST(postRequest({ token: '', password: 'short' }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.details).toBeDefined();
  });

  it('returns 410 for an unknown token', async () => {
    const res = await POST(postRequest({ token: 'bogus-token', password: 'a-long-enough-password' }));
    expect(res.status).toBe(410);
  });

  it('returns 410 for an expired token', async () => {
    const { rawToken } = await inviteUser('New Person', 'new@example.com', 'sales');
    const user = await db.query.staffUsers.findFirst({ where: eq(schema.staffUsers.email, 'new@example.com') });
    await db
      .update(schema.staffUsers)
      .set({ inviteTokenExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.staffUsers.id, user!.id));

    const res = await POST(postRequest({ token: rawToken, password: 'a-long-enough-password' }));
    expect(res.status).toBe(410);
  });

  it('returns 200, activates the user, sets the password, and clears the invite token', async () => {
    const { rawToken } = await inviteUser('New Person', 'new@example.com', 'sales');

    const res = await POST(postRequest({ token: rawToken, password: 'a-long-enough-password' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });

    const user = await db.query.staffUsers.findFirst({ where: eq(schema.staffUsers.email, 'new@example.com') });
    expect(user!.isActive).toBe(true);
    expect(user!.inviteTokenHash).toBeNull();
    expect(user!.inviteTokenExpiresAt).toBeNull();
    expect(await verifyPassword('a-long-enough-password', user!.passwordHash)).toBe(true);
  });

  it('returns 410 when the same invite token is redeemed twice', async () => {
    const { rawToken } = await inviteUser('New Person', 'new@example.com', 'sales');
    await POST(postRequest({ token: rawToken, password: 'a-long-enough-password' }));

    const res = await POST(postRequest({ token: rawToken, password: 'another-long-password' }));
    expect(res.status).toBe(410);
  });
});
