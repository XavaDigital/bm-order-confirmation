import { NextResponse } from 'next/server';
import { updateRosterMember, removeRosterMember } from '@/server/roster/service';
import { updateRosterMemberSchema } from '@/server/roster/contract';
import { defineRoute } from '@/lib/route-handler';

export const PATCH = defineRoute<{ id: string; memberId: string }, typeof updateRosterMemberSchema._type>({
  auth: 'staff',
  tag: 'admin/roster/members PATCH',
  schema: updateRosterMemberSchema,
  handler: async ({ params, body, session }) => {
    await updateRosterMember(params.memberId, body, { actorEmail: session!.email });
    return NextResponse.json({ ok: true });
  },
});

export const DELETE = defineRoute<{ id: string; memberId: string }>({
  auth: 'staff',
  tag: 'admin/roster/members DELETE',
  handler: async ({ params }) => {
    await removeRosterMember(params.memberId);
    return NextResponse.json({ ok: true });
  },
});
