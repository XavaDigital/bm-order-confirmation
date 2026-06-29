import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import { listStaffUsers, inviteUser, UserConflictError } from '@/server/users/service';
import { sendInviteEmail, isEmailConfigured } from '@/lib/email';

const inviteSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(['sales', 'admin']),
});

async function requireAdmin() {
  const session = await getSession();
  if (!session.userId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (session.role !== 'admin') return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  return { session };
}

export async function GET() {
  const check = await requireAdmin();
  if (check.error) return check.error;

  try {
    const users = await listStaffUsers();
    return NextResponse.json(users);
  } catch (err) {
    console.error('[admin/users GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const check = await requireAdmin();
  if (check.error) return check.error;

  const body = await request.json().catch(() => null);
  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const { rawToken, setupUrl } = await inviteUser(
      parsed.data.name,
      parsed.data.email,
      parsed.data.role,
    );

    if (isEmailConfigured()) {
      await sendInviteEmail({
        to: parsed.data.email,
        toName: parsed.data.name,
        inviterName: check.session!.name,
        role: parsed.data.role,
        setupUrl,
      });
    }

    return NextResponse.json({ ok: true, setupUrl: isEmailConfigured() ? undefined : setupUrl }, { status: 201 });
  } catch (err) {
    if (err instanceof UserConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error('[admin/users POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
