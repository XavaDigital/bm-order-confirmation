import { NextRequest, NextResponse } from 'next/server';
import { generateMemberToken, getRosterMember } from '@/server/roster/service';
import { NotFoundError } from '@/server/orders/service';
import { getSession } from '@/lib/session';

type Params = { params: Promise<{ id: string; memberId: string }> };

/** Generate (or regenerate) this team member's individual roster link. */
export async function POST(_req: NextRequest, { params }: Params) {
  const { id: orderId, memberId } = await params;
  try {
    const session = await getSession();
    await getRosterMember(orderId, memberId);
    const result = await generateMemberToken(memberId, { actorEmail: session.email });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    console.error('[admin/roster/members/link POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
