import { NextResponse } from 'next/server';
import { generateRosterToken, revokeRosterToken } from '@/server/roster/service';
import { defineRoute } from '@/lib/route-handler';

/** Generate (or regenerate) the shared team-roster link for this order. */
export const POST = defineRoute<{ id: string }>({
  auth: 'staff',
  tag: 'admin/roster/token POST',
  handler: async ({ params, session }) => {
    const result = await generateRosterToken(params.id, { actorEmail: session!.email });
    return NextResponse.json(result, { status: 201 });
  },
});

/** Revoke the current team-roster link. */
export const DELETE = defineRoute<{ id: string }>({
  auth: 'staff',
  tag: 'admin/roster/token DELETE',
  handler: async ({ params, session }) => {
    await revokeRosterToken(params.id, { actorEmail: session!.email });
    return NextResponse.json({ ok: true });
  },
});
