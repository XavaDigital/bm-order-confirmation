import { NextResponse } from 'next/server';
import { z } from 'zod';
import { defineRoute } from '@/lib/route-handler';
import { updateStage } from '@/server/workflow/stage-admin';

const updateStageSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  color: z.string().trim().max(30).nullish(),
  warnAfterHours: z.number().int().positive().max(24 * 365).nullish(),
  urgentAfterHours: z.number().int().positive().max(24 * 365).nullish(),
  defaultConfirmationPolicy: z.enum(['any', 'all']).optional(),
  isActive: z.boolean().optional(),
  isTerminal: z.boolean().optional(),
});

/**
 * Edit one stage. There is deliberately no DELETE: order and purchase-order
 * rows carry the stage SLUG, so a deleted stage would strand every card sitting
 * in it. Retiring is `isActive: false`, and the protected one-per-status stages
 * refuse even that (409) — the board resolves to them as a fallback.
 *
 * `statusKey` and `slug` are not editable. Moving a stage to another status
 * would silently relocate every card in it, and the slug is what those cards
 * reference; both would be a rename in disguise.
 */
export const PATCH = defineRoute<{ id: string }, typeof updateStageSchema._type>({
  auth: 'admin',
  tag: 'admin/workflow/stages/[id] PATCH',
  schema: updateStageSchema,
  handler: async ({ params, body, session }) =>
    NextResponse.json(await updateStage(params.id, body, { actorEmail: session!.email })),
});
