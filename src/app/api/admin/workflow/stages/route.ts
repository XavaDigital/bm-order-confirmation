import { NextResponse } from 'next/server';
import { z } from 'zod';
import { badRequest } from '@/lib/api-responses';
import { defineRoute } from '@/lib/route-handler';
import { listAllStages } from '@/server/workflow/stages';
import { createStage, reorderStages, statusKeysFor } from '@/server/workflow/stage-admin';

const boardKeySchema = z.enum(['order', 'purchase_order']);

const createStageSchema = z.object({
  boardKey: boardKeySchema,
  name: z.string().trim().min(1).max(80),
  statusKey: z.string().trim().min(1).max(60),
  color: z.string().trim().max(30).nullish(),
  warnAfterHours: z.number().int().positive().max(24 * 365).nullish(),
  urgentAfterHours: z.number().int().positive().max(24 * 365).nullish(),
  defaultConfirmationPolicy: z.enum(['any', 'all']).optional(),
});

const reorderSchema = z.object({
  boardKey: boardKeySchema,
  orderedStageIds: z.array(z.string().uuid()).max(200),
});

/**
 * Every stage on a board, INCLUDING inactive ones — this is the settings view,
 * where a retired step still has to be visible to be brought back.
 *
 * `auth: 'viewer'` so a read-only account can see how the board is configured;
 * every write below is admin.
 */
export const GET = defineRoute({
  auth: 'viewer',
  tag: 'admin/workflow/stages GET',
  handler: async ({ request }) => {
    const parsed = boardKeySchema.safeParse(new URL(request.url).searchParams.get('boardKey'));
    if (!parsed.success) return badRequest(parsed.error);

    return NextResponse.json({
      stages: await listAllStages(parsed.data),
      // The statuses a stage may sit under. Sent with the list so the editor
      // does not have to keep its own copy of the state machine.
      statusKeys: statusKeysFor(parsed.data),
    });
  },
});

/**
 * Add a step to a status group. `auth: 'admin'` — changing the shape of the
 * board is a management act, unlike moving a card across it.
 */
export const POST = defineRoute<Record<string, never>, typeof createStageSchema._type>({
  auth: 'admin',
  tag: 'admin/workflow/stages POST',
  schema: createStageSchema,
  handler: async ({ body, session }) =>
    NextResponse.json(await createStage(body, { actorEmail: session!.email }), { status: 201 }),
});

/** Apply a whole ordering at once — see reorderStages for why not from/to. */
export const PUT = defineRoute<Record<string, never>, typeof reorderSchema._type>({
  auth: 'admin',
  tag: 'admin/workflow/stages PUT',
  schema: reorderSchema,
  handler: async ({ body, session }) =>
    NextResponse.json({
      stages: await reorderStages(body.boardKey, body.orderedStageIds, {
        actorEmail: session!.email,
      }),
    }),
});
