import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import QRCode from 'qrcode';
import { db } from '@/db';
import { staffUsers } from '@/db/schema';
import { getSession } from '@/lib/session';
import { verifyPassword } from '@/lib/password';
import { generateTotpSecret, generateTotpUri } from '@/server/auth/totp';

const bodySchema = z.object({
  password: z.string().min(1),
});

/**
 * POST /api/admin/auth/2fa/setup
 * Generates a new TOTP secret and returns a QR code data URL + the raw secret.
 * Does NOT enable 2FA yet — the user must confirm with a valid code first.
 * Requires the user's current password (matching /disable) so a hijacked
 * session alone can't silently re-enroll 2FA under an attacker's control.
 */
export async function POST(request: NextRequest) {
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

  if (user.totpEnabled) {
    return NextResponse.json(
      { error: '2FA is already enabled. Disable it first to re-enroll.' },
      { status: 400 },
    );
  }

  const valid = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: 'Incorrect password' }, { status: 401 });
  }

  const secret = generateTotpSecret();
  const uri = generateTotpUri(secret, session.email);
  const qrDataUrl = await QRCode.toDataURL(uri, { width: 200, margin: 1 });

  // Persist the pending secret (not yet enabled — totpEnabled stays false).
  await db
    .update(staffUsers)
    .set({ totpSecret: secret, updatedAt: new Date() })
    .where(eq(staffUsers.id, session.userId));

  return NextResponse.json({ secret, qrDataUrl });
}
