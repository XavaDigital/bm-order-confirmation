import { NextResponse } from 'next/server';
import { z } from 'zod';
import { defineRoute } from '@/lib/route-handler';
import {
  getPoChecklist,
  setChecklistItem,
} from '@/server/purchase-orders/checklist-service';

/** The PO's pre-send checklist with per-item satisfaction (auto or ticked). */
export const GET = defineRoute<{ id: string }>({
  auth: 'viewer',
  tag: 'purchase-orders/[id]/checklist GET',
  handler: async ({ params }) => NextResponse.json({ items: await getPoChecklist(params.id) }),
});

const tickSchema = z.object({ itemId: z.string().uuid(), checked: z.boolean() });

/** Tick/untick a manual item — recorded with who/when. */
export const POST = defineRoute<{ id: string }, typeof tickSchema._type>({
  auth: 'staff',
  tag: 'purchase-orders/[id]/checklist POST',
  schema: tickSchema,
  handler: async ({ params, body, session }) => {
    await setChecklistItem(params.id, body.itemId, body.checked, {
      actorEmail: session!.email,
    });
    return NextResponse.json({ items: await getPoChecklist(params.id) });
  },
});
