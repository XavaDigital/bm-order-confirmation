import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { staffUsers } from '@/db/schema';
import { getSession } from '@/lib/session';

export async function GET() {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await db.query.staffUsers.findFirst({
    where: eq(staffUsers.id, session.userId),
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
}
