import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { staffUsers } from '@/db/schema';
import { verifyPassword } from '@/lib/password';
import { defineRoute } from '@/lib/route-handler';

const bodySchema = z.object({
  password: z.string().min(1),
});

/**
 * DELETE /api/admin/auth/2fa/disable
 * Disables 2FA. Requires the user's current password to prevent CSRF abuse.
 */
export const DELETE = defineRoute<Record<string, never>, typeof bodySchema._type>({
  auth: 'staff',
  tag: 'admin/auth/2fa/disable DELETE',
  schema: bodySchema,
  handler: async ({ body, session }) => {
    const user = await db.query.staffUsers.findFirst({
      where: eq(staffUsers.id, session!.userId),
      columns: { passwordHash: true, totpEnabled: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (!user.totpEnabled) {
      return NextResponse.json({ error: '2FA is not enabled' }, { status: 400 });
    }

    const valid = await verifyPassword(body.password, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: 'Incorrect password' }, { status: 401 });
    }

    await db
      .update(staffUsers)
      .set({ totpEnabled: false, totpSecret: null, totpBackupCodes: null, updatedAt: new Date() })
      .where(eq(staffUsers.id, session!.userId));

    return NextResponse.json({ ok: true });
  },
});
