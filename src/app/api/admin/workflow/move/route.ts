import { NextResponse } from 'next/server';
import { moveEntityToStage } from '@/server/workflow/moves';
import { moveEntitySchema } from '@/server/workflow/contract';
import { defineRoute } from '@/lib/route-handler';

/**
 * Move a card to another stage.
 *
 * `auth: 'staff'`, a deliberate departure from the `canMutate = role === 'admin'`
 * convention used elsewhere in the admin UI: that rule would stop sales moving
 * their own jobs, which is the entire point of the board. The protection is that
 * an illegal move is *rejected*, not that only admins can attempt one — the
 * service checks the stage layer and the existing status guards, and a refusal
 * comes back as 409 with `details` so the UI can say what blocked it.
 */
export const POST = defineRoute<Record<string, never>, typeof moveEntitySchema._type>({
  auth: 'staff',
  tag: 'admin/workflow/move POST',
  schema: moveEntitySchema,
  handler: async ({ body, session }) =>
    NextResponse.json(
      await moveEntityToStage(body.boardKey, body.entityId, body.toStageSlug, {
        actorEmail: session!.email,
      }),
    ),
});
