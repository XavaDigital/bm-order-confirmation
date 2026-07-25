import { NextResponse } from 'next/server';
import { z } from 'zod';
import { listStaffUsers, inviteUser } from '@/server/users/service';
import { sendInviteEmail, isEmailConfigured } from '@/lib/email';
import { defineRoute } from '@/lib/route-handler';

const inviteSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(['sales', 'admin']),
});

export const GET = defineRoute({
  auth: 'admin',
  tag: 'admin/users GET',
  handler: async () => NextResponse.json(await listStaffUsers()),
});

export const POST = defineRoute<Record<string, never>, typeof inviteSchema._type>({
  auth: 'admin',
  tag: 'admin/users POST',
  schema: inviteSchema,
  handler: async ({ body, session }) => {
    const { setupUrl } = await inviteUser(body.name, body.email, body.role);

    if (isEmailConfigured()) {
      await sendInviteEmail({
        to: body.email,
        toName: body.name,
        inviterName: session!.name,
        role: body.role,
        setupUrl,
      });
    }

    return NextResponse.json(
      { ok: true, setupUrl: isEmailConfigured() ? undefined : setupUrl },
      { status: 201 },
    );
  },
});
