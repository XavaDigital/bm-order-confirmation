import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAssignees, setAssignees } from '@/server/workflow/assignments';
import { badRequest } from '@/lib/api-responses';
import { defineRoute } from '@/lib/route-handler';

const entityTypeSchema = z.enum(['order', 'purchase_order', 'workflow_stage']);

const setAssigneesSchema = z.object({
  entityType: entityTypeSchema,
  entityId: z.string().uuid(),
  staffUserIds: z.array(z.string().uuid()).max(50),
});

export const GET = defineRoute({
  auth: 'staff',
  tag: 'admin/workflow/assignees GET',
  handler: async ({ request }) => {
    const url = new URL(request.url);
    const parsed = entityTypeSchema.safeParse(url.searchParams.get('entityType'));
    const entityId = url.searchParams.get('entityId');
    if (!parsed.success) return badRequest(parsed.error);
    if (!entityId) return NextResponse.json({ error: 'entityId is required' }, { status: 400 });

    return NextResponse.json(await getAssignees(parsed.data, entityId));
  },
});

/**
 * Replace an entity's owner set. `auth: 'admin'` — deciding who is accountable
 * for a step is a management act, unlike doing the step (staff) or moving a card
 * (staff).
 */
export const PUT = defineRoute<Record<string, never>, typeof setAssigneesSchema._type>({
  auth: 'admin',
  tag: 'admin/workflow/assignees PUT',
  schema: setAssigneesSchema,
  handler: async ({ body, session }) =>
    NextResponse.json(
      await setAssignees(body.entityType, body.entityId, body.staffUserIds, {
        actorEmail: session!.email,
        actorStaffUserId: session!.userId,
      }),
    ),
});
