import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateSync } from 'otplib';
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
import { generateTotpSecret, generateBackupCodes } from '@/server/auth/totp';
import { POST } from './route';

afterEach(async () => {
  await resetTestDb(db);
  const session = (await getSession()) as unknown as Record<string, unknown>;
  for (const key of Object.keys(session)) delete session[key];
});

async function seedMfaStaff() {
  const secret = generateTotpSecret();
  const { hashed } = generateBackupCodes();
  const [staff] = await db
    .insert(schema.staffUsers)
    .values({
      email: 'mfa@example.com',
      passwordHash: 'unused',
      name: 'MFA Staff',
      totpEnabled: true,
      totpSecret: secret,
      totpBackupCodes: hashed,
    })
    .returning();
  return { staff, secret, backupCodesHashed: hashed };
}

async function setPendingSession(userId: string) {
  const session = (await getSession()) as unknown as Record<string, unknown>;
  session.userId = userId;
  session.mfaPending = true;
}

function verifyRequest(code: string, ip = '10.1.0.1') {
  return new NextRequest('http://localhost/api/auth/2fa/verify', {
    method: 'POST',
    body: JSON.stringify({ code }),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
  });
}

describe('POST /api/auth/2fa/verify', () => {
  it('returns 401 when there is no pending MFA session', async () => {
    const res = await POST(verifyRequest('123456'));
    expect(res.status).toBe(401);
  });

  it('accepts a valid live TOTP code and clears mfaPending', async () => {
    const { staff, secret } = await seedMfaStaff();
    await setPendingSession(staff.id);
    const code = generateSync({ secret });

    const res = await POST(verifyRequest(code, '10.1.0.2'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toEqual({ name: 'MFA Staff', email: 'mfa@example.com', role: 'sales' });

    const session = (await getSession()) as unknown as { mfaPending: boolean };
    expect(session.mfaPending).toBe(false);
  });

  it('rejects a wrong code with no matching backup code', async () => {
    const { staff } = await seedMfaStaff();
    await setPendingSession(staff.id);
    const res = await POST(verifyRequest('000000', '10.1.0.3'));
    expect(res.status).toBe(401);
  });

  it('accepts a valid backup code and consumes it (single use)', async () => {
    const { staff, backupCodesHashed } = await seedMfaStaff();
    await setPendingSession(staff.id);

    // Need the RAW backup code, not the hash - regenerate deterministically isn't
    // possible from the hash, so seed with a known raw/hash pair directly.
    const rawCode = 'ABCDE-12345';
    const { hashBackupCode } = await import('@/server/auth/totp');
    const knownHash = hashBackupCode(rawCode);
    await db
      .update(schema.staffUsers)
      .set({ totpBackupCodes: [...backupCodesHashed, knownHash] })
      .where(eq(schema.staffUsers.id, staff.id));

    const first = await POST(verifyRequest(rawCode, '10.1.0.4'));
    expect(first.status).toBe(200);

    // Re-establish a pending session (the first call cleared mfaPending) and retry the same code.
    await setPendingSession(staff.id);
    const second = await POST(verifyRequest(rawCode, '10.1.0.5'));
    expect(second.status).toBe(401);
  });

  it('rate limits after 5 attempts for the same user+IP', async () => {
    const { staff } = await seedMfaStaff();
    const ip = '10.1.0.9';
    for (let i = 0; i < 5; i++) {
      await setPendingSession(staff.id);
      const res = await POST(verifyRequest('000000', ip));
      expect(res.status).toBe(401);
    }
    await setPendingSession(staff.id);
    const sixth = await POST(verifyRequest('000000', ip));
    expect(sixth.status).toBe(429);
  });
});
