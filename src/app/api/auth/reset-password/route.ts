import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resetPassword, ResetTokenExpiredError } from '@/server/users/service';
import { defineRoute } from '@/lib/route-handler';

const bodySchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const POST = defineRoute<Record<string, never>, typeof bodySchema._type>({
  auth: 'public',
  tag: 'auth/reset-password POST',
  schema: bodySchema,
  handler: async ({ body }) => {
    try {
      await resetPassword(body.token, body.password);
      return NextResponse.json({ ok: true });
    } catch (err) {
      // 410, not the wrapper's NotFound/Conflict mapping — keep explicit.
      if (err instanceof ResetTokenExpiredError) {
        return NextResponse.json({ error: err.message }, { status: 410 });
      }
      throw err;
    }
  },
});
