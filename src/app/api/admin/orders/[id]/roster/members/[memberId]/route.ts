import { NextRequest, NextResponse } from 'next/server';
import { updateRosterMember, removeRosterMember } from '@/server/roster/service';
import { updateRosterMemberSchema } from '@/server/roster/contract';
import { NotFoundError } from '@/server/orders/service';
import { badRequest } from '@/lib/api-responses';

type Params = { params: Promise<{ id: string; memberId: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const { memberId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = updateRosterMemberSchema.safeParse(body);

  if (!parsed.success) {
    return badRequest(parsed.error);
  }

  try {
    await updateRosterMember(memberId, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    console.error('[admin/roster/members PATCH]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { memberId } = await params;
  try {
    await removeRosterMember(memberId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    console.error('[admin/roster/members DELETE]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
