import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { staffUsers } from '@/db/schema';
import { getSession } from '@/lib/session';
import { verifyTotp, consumeBackupCode } from '@/server/auth/totp';
import { getClientIp, rateLimitedResponse } from '@/lib/rate-limit';

const bodySchema = z.object({
  code: z.string().min(1).max(20),
});

export async function POST(request: NextRequest) {
  const session = await getSession();

  // Must have completed password auth with MFA pending.
  if (!session.userId || !session.mfaPending) {
    return NextResponse.json({ error: 'No pending MFA session' }, { status: 401 });
  }

  const ip = getClientIp(request.headers);
  const rateLimited = await rateLimitedResponse(`2fa:${session.userId}:${ip}`, 5, 5 * 60 * 1_000, 'Too many attempts. Please try again later.');
  if (rateLimited) return rateLimited;

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const user = await db.query.staffUsers.findFirst({
    where: eq(staffUsers.id, session.userId),
  });

  if (!user || !user.totpEnabled || !user.totpSecret) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
  }

  const code = parsed.data.code.trim();

  // Try TOTP first, then backup codes.
  const totpValid = verifyTotp(code, user.totpSecret);

  if (!totpValid) {
    // Try backup code (strip dashes, case-insensitive).
    const storedHashes = (user.totpBackupCodes as string[] | null) ?? [];
    const remaining = consumeBackupCode(code, storedHashes);

    if (remaining === null) {
      return NextResponse.json({ error: 'Invalid code' }, { status: 401 });
    }

    // Consume the backup code.
    await db
      .update(staffUsers)
      .set({ totpBackupCodes: remaining, updatedAt: new Date() })
      .where(eq(staffUsers.id, user.id));
  }

  // 2FA verified — promote the session to fully authenticated.
  session.mfaPending = false;
  await session.save();

  return NextResponse.json({ ok: true, user: { name: user.name, email: user.email, role: user.role } });
}
