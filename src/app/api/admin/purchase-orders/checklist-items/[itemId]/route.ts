import { NextResponse } from 'next/server';
import { defineRoute } from '@/lib/route-handler';
import { updateChecklistItemSchema } from '@/server/purchase-orders/checklist-contract';
import { updateChecklistItem } from '@/server/purchase-orders/checklist-service';

/** Edit or retire one check (deactivate-never-delete — see the service). */
export const PATCH = defineRoute<
  { itemId: string },
  typeof updateChecklistItemSchema._type
>({
  auth: 'admin',
  tag: 'admin/purchase-orders/checklist-items/[itemId] PATCH',
  schema: updateChecklistItemSchema,
  handler: async ({ params, body, session }) =>
    NextResponse.json({
      item: await updateChecklistItem(params.itemId, body, { actorEmail: session!.email }),
    }),
});
