import { NextResponse } from 'next/server';
import { defineRoute } from '@/lib/route-handler';
import { issueRevision, listRevisions } from '@/server/purchase-orders/service';
import { issueRevisionSchema } from '@/server/purchase-orders/contract';

export const GET = defineRoute<{ id: string }>({
  auth: 'staff',
  tag: 'purchase-orders [id]/revisions GET',
  handler: async ({ params }) => NextResponse.json(await listRevisions(params.id)),
});

export const POST = defineRoute<{ id: string }, typeof issueRevisionSchema._type>({
  auth: 'staff',
  tag: 'purchase-orders [id]/revisions POST',
  schema: issueRevisionSchema,
  handler: async ({ params, body, session }) => {
    const revision = await issueRevision(params.id, body, {
      actorStaffUserId: session!.userId,
      actorEmail: session!.email,
    });
    return NextResponse.json(revision, { status: 201 });
  },
});
