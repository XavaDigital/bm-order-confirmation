import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import QRCode from 'qrcode';
import { db } from '@/db';
import { staffUsers } from '@/db/schema';
import { getSession } from '@/lib/session';
import { generateTotpSecret, generateTotpUri } from '@/server/auth/totp';

/**
 * POST /api/admin/auth/2fa/setup
 * Generates a new TOTP secret and returns a QR code data URL + the raw secret.
 * Does NOT enable 2FA yet — the user must confirm with a valid code first.
 */
export async function POST() {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
