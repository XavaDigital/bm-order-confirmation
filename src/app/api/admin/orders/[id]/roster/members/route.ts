import { NextResponse } from 'next/server';
import { addRosterMember, RosterFullError } from '@/server/roster/service';
import { addRosterMemberSchema } from '@/server/roster/contract';
import { conflict } from '@/lib/api-responses';
import { defineRoute } from '@/lib/route-handler';

export const POST = defineRoute<{ id: string }, typeof addRosterMemberSchema._type>({
  auth: 'staff',
  tag: 'admin/roster/members POST',
  schema: addRosterMemberSchema,
  handler: async ({ params, body }) => {
    try {
      const member = await addRosterMember(params.id, body);
      return NextResponse.json(member, { status: 201 });
    } catch (err) {
      // RosterFullError doesn't match the wrapper's *ConflictError suffix —
      // keep its 409 here; NotFoundError falls through to the wrapper.
      if (err instanceof RosterFullError) return conflict(err.message);
      throw err;
    }
  },
});
