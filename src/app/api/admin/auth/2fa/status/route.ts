import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { staffUsers } from '@/db/schema';
import { defineRoute } from '@/lib/route-handler';

export const GET = defineRoute({
  auth: 'viewer',
  tag: 'admin/auth/2fa/status GET',
  handler: async ({ session }) => {
    const user = await db.query.staffUsers.findFirst({
      where: eq(staffUsers.id, session!.userId),
      columns: { totpEnabled: true, totpBackupCodes: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const backupCodesRemaining = ((user.totpBackupCodes as string[] | null) ?? []).length;

    return NextResponse.json({
      enabled: user.totpEnabled,
      backupCodesRemaining,
    });
  },
});
