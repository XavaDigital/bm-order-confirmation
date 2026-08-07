import { NextResponse } from 'next/server';
import { z } from 'zod';
import { defineRoute } from '@/lib/route-handler';
import { approveSubmission } from '@/server/purchase-orders/service';
import { PO_STATUSES } from '@/server/purchase-orders/contract';

const bodySchema = z.object({
  /** Advance the PO in the same act — "approved, now do the next phase". */
  advanceTo: z.enum(PO_STATUSES).nullable().optional(),
  /** Anything to say to the supplier; rides the shared note they will see. */
  comment: z.string().trim().max(2000).optional(),
});

/** Approve what the supplier submitted, clearing the awaiting-approval flag. */
export const POST = defineRoute<{ id: string }, typeof bodySchema._type>({
  auth: 'staff',
  tag: 'purchase-orders/[id]/approve POST',
  schema: bodySchema,
  handler: async ({ params, body, session }) => {
    const result = await approveSubmission(params.id, {
      actorEmail: session!.email,
      actorStaffUserId: session!.userId,
      advanceTo: body.advanceTo ?? null,
      comment: body.comment ?? null,
    });
    return NextResponse.json({ ok: true, ...result });
  },
});
