import { NextResponse } from 'next/server';
import { getBoard } from '@/server/workflow/board';
import { boardKeySchema } from '@/server/workflow/contract';
import { badRequest } from '@/lib/api-responses';
import { defineRoute } from '@/lib/route-handler';

/**
 * The Kanban board for one entity type.
 *
 * `auth: 'staff'` — a board that only admins could read would be useless to the
 * sales and production people whose work it shows. Moves are also staff-level;
 * configuring the stages is admin-only (see the stages routes).
 */
export const GET = defineRoute({
  auth: 'staff',
  tag: 'admin/workflow/board GET',
  handler: async ({ request }) => {
    const url = new URL(request.url);
    const parsed = boardKeySchema.safeParse(url.searchParams.get('boardKey') ?? 'order');
    if (!parsed.success) return badRequest(parsed.error);

    const includeCancelled = url.searchParams.get('includeCancelled') === '1';

    return NextResponse.json(await getBoard(parsed.data, { includeCancelled }));
  },
});
