import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { staffUsers } from '@/db/schema';
import { verifyPassword, hashPassword } from '@/lib/password';
import { defineRoute } from '@/lib/route-handler';

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
export const POST = defineRoute<Record<string, never>, typeof bodySchema._type>({
  auth: 'staff',
  tag: 'admin/auth/change-password POST',
  schema: bodySchema,
  handler: async ({ body, session }) => {
    const user = await db.query.staffUsers.findFirst({
      where: eq(staffUsers.id, session!.userId),
      columns: { passwordHash: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const valid = await verifyPassword(body.currentPassword, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: 'Incorrect password' }, { status: 401 });
    }

    const passwordHash = await hashPassword(body.newPassword);

    await db
      .update(staffUsers)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(staffUsers.id, session!.userId));

    return NextResponse.json({ ok: true });
  },
});
