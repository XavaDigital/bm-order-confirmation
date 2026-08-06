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

const tickSchema = z.object({
  itemId: z.string().uuid(),
  checked: z.boolean(),
  /**
   * Present = this is a SIDESTEP acknowledgement, not a "done" tick (David,
   * 2026-08-06). Only legal on items configured to allow it; the service
   * 409s otherwise. Min length is the point: an unreasoned acknowledgement
   * is the silent skip the checklist exists to prevent.
   */
  sidestepReason: z.string().trim().min(3).max(500).optional(),
});

/** Tick/untick/sidestep a manual item — recorded with who/when. */
export const POST = defineRoute<{ id: string }, typeof tickSchema._type>({
  auth: 'staff',
  tag: 'purchase-orders/[id]/checklist POST',
  schema: tickSchema,
  handler: async ({ params, body, session }) => {
    await setChecklistItem(params.id, body.itemId, body.checked, {
      actorEmail: session!.email,
      sidestepReason: body.sidestepReason ?? null,
    });
    return NextResponse.json({ items: await getPoChecklist(params.id) });
  },
});
