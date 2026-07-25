import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import QRCode from 'qrcode';
import { db } from '@/db';
import { staffUsers } from '@/db/schema';
import { verifyPassword } from '@/lib/password';
import { generateTotpSecret, generateTotpUri } from '@/server/auth/totp';
import { defineRoute } from '@/lib/route-handler';

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
export const POST = defineRoute<Record<string, never>, typeof bodySchema._type>({
  auth: 'staff',
  tag: 'admin/auth/2fa/setup POST',
  schema: bodySchema,
  handler: async ({ body, session }) => {
    const user = await db.query.staffUsers.findFirst({
      where: eq(staffUsers.id, session!.userId),
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

    const valid = await verifyPassword(body.password, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: 'Incorrect password' }, { status: 401 });
    }

    const secret = generateTotpSecret();
    const uri = generateTotpUri(secret, session!.email);
    const qrDataUrl = await QRCode.toDataURL(uri, { width: 200, margin: 1 });

    // Persist the pending secret (not yet enabled — totpEnabled stays false).
    await db
      .update(staffUsers)
      .set({ totpSecret: secret, updatedAt: new Date() })
      .where(eq(staffUsers.id, session!.userId));

    return NextResponse.json({ secret, qrDataUrl });
  },
});
