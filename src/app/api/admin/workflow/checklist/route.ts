import { NextResponse } from 'next/server';
import { getChecklist } from '@/server/workflow/tasks';
import { boardKeySchema } from '@/server/workflow/contract';
import { badRequest } from '@/lib/api-responses';
import { defineRoute } from '@/lib/route-handler';

/**
 * The pre-production checklist for one entity's current stage.
 *
 * Staff-level: the people who do these steps are the ones who need to see and
 * tick them.
 */
export const GET = defineRoute({
  auth: 'staff',
  tag: 'admin/workflow/checklist GET',
  handler: async ({ request }) => {
    const url = new URL(request.url);
    const board = boardKeySchema.safeParse(url.searchParams.get('boardKey') ?? 'order');
    const entityId = url.searchParams.get('entityId');
    if (!board.success) return badRequest(board.error);
    if (!entityId) return NextResponse.json({ error: 'entityId is required' }, { status: 400 });

    return NextResponse.json(await getChecklist(board.data, entityId));
  },
});
