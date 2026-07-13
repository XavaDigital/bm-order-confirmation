import { NextRequest, NextResponse } from 'next/server';
import { addRosterMember } from '@/server/roster/service';
import { addRosterMemberSchema } from '@/server/roster/contract';
import { NotFoundError } from '@/server/orders/service';
import { badRequest } from '@/lib/api-responses';

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { id: orderId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = addRosterMemberSchema.safeParse(body);

  if (!parsed.success) {
    return badRequest(parsed.error);
  }

  try {
    const member = await addRosterMember(orderId, parsed.data);
    return NextResponse.json(member, { status: 201 });
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    console.error('[admin/roster/members POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
