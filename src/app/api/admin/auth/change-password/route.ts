import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { staffUsers } from '@/db/schema';
import { getSession } from '@/lib/session';
import { verifyPassword, hashPassword } from '@/lib/password';

const bodySchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
});

/**
 * POST /api/admin/auth/change-password
 * Self-service password change. Requires the user's current password
 * (matching the 2FA setup/disable routes) so a hijacked session alone can't
 * silently lock out the real owner.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 });
  }

  const user = await db.query.staffUsers.findFirst({
    where: eq(staffUsers.id, session.userId),
    columns: { passwordHash: true },
  });

  if (!user) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const valid = await verifyPassword(parsed.data.currentPassword, user.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: 'Incorrect password' }, { status: 401 });
  }

  const passwordHash = await hashPassword(parsed.data.newPassword);

  await db
    .update(staffUsers)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(staffUsers.id, session.userId));

  return NextResponse.json({ ok: true });
}
