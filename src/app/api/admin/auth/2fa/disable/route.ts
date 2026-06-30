import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { staffUsers } from '@/db/schema';
import { getSession } from '@/lib/session';
import { verifyPassword } from '@/lib/password';

const bodySchema = z.object({
  password: z.string().min(1),
});

/**
 * DELETE /api/admin/auth/2fa/disable
 * Disables 2FA. Requires the user's current password to prevent CSRF abuse.
 */
export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Password required' }, { status: 400 });
  }

  const user = await db.query.staffUsers.findFirst({
    where: eq(staffUsers.id, session.userId),
    columns: { passwordHash: true, totpEnabled: true },
  });

  if (!user) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (!user.totpEnabled) {
    return NextResponse.json({ error: '2FA is not enabled' }, { status: 400 });
  }

  const valid = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: 'Incorrect password' }, { status: 401 });
  }

  await db
    .update(staffUsers)
    .set({ totpEnabled: false, totpSecret: null, totpBackupCodes: null, updatedAt: new Date() })
    .where(eq(staffUsers.id, session.userId));

  return NextResponse.json({ ok: true });
}
