import { NextResponse } from 'next/server';
import { generateMemberToken, getRosterMember } from '@/server/roster/service';
import { defineRoute } from '@/lib/route-handler';

/** Generate (or regenerate) this team member's individual roster link. */
export const POST = defineRoute<{ id: string; memberId: string }>({
  auth: 'staff',
  tag: 'admin/roster/members/link POST',
  handler: async ({ params, session }) => {
    await getRosterMember(params.id, params.memberId);
    const result = await generateMemberToken(params.memberId, { actorEmail: session!.email });
    return NextResponse.json(result, { status: 201 });
  },
});
