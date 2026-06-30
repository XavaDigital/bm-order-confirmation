import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { staffUsers } from '@/db/schema';
import { getSession } from '@/lib/session';
import { verifyTotp, generateBackupCodes } from '@/server/auth/totp';

const bodySchema = z.object({
  code: z.string().length(6),
});

/**
 * POST /api/admin/auth/2fa/confirm
 * Validates the first TOTP code and enables 2FA for the user.
 * Returns 8 one-time backup codes (shown once, never again).
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const user = await db.query.staffUsers.findFirst({
    where: eq(staffUsers.id, session.userId),
    columns: { totpSecret: true, totpEnabled: true },
  });

  if (!user?.totpSecret) {
    return NextResponse.json({ error: 'No pending 2FA setup. Call /setup first.' }, { status: 400 });
  }

  if (!verifyTotp(parsed.data.code, user.totpSecret)) {
    return NextResponse.json({ error: 'Invalid code' }, { status: 401 });
  }

  const { raw, hashed } = generateBackupCodes();

  await db
    .update(staffUsers)
    .set({ totpEnabled: true, totpBackupCodes: hashed, updatedAt: new Date() })
    .where(eq(staffUsers.id, session.userId));

  return NextResponse.json({ ok: true, backupCodes: raw });
}
