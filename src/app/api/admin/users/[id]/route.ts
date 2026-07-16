import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/session';
import { badRequest } from '@/lib/api-responses';
import { updateUser, deleteUser, UserNotFoundError, LastAdminError } from '@/server/users/service';
import { logger } from '@/lib/logger';

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  role: z.enum(['sales', 'admin']).optional(),
  isActive: z.boolean().optional(),
}).refine((d) => d.role !== undefined || d.isActive !== undefined, {
  message: 'At least one of role or isActive must be provided',
});

export async function PATCH(request: NextRequest, { params }: Params) {
  const check = await requireAdmin();
  if (check.error) return check.error;

  const { id } = await params;

  // Prevent self-modification of role/status.
  if (id === check.session!.userId) {
    return NextResponse.json({ error: 'You cannot modify your own role or status' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error);
  }

  try {
    const user = await updateUser(id, parsed.data);
    return NextResponse.json(user);
  } catch (err) {
    if (err instanceof UserNotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    if (err instanceof LastAdminError) return NextResponse.json({ error: err.message }, { status: 409 });
    logger.error('[admin/users PATCH]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const check = await requireAdmin();
  if (check.error) return check.error;

  const { id } = await params;

  if (id === check.session!.userId) {
    return NextResponse.json({ error: 'You cannot delete your own account' }, { status: 400 });
  }

  try {
    await deleteUser(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof UserNotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    logger.error('[admin/users DELETE]', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal server error' }, { status: 500 });
  }
}
