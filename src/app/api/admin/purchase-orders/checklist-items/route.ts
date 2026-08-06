/**
 * The pre-send checklist's CONFIGURATION (David, 2026-08-06) — the checks
 * themselves, not one PO's ticks. Those live at
 * `/api/admin/purchase-orders/[id]/checklist`; this static segment sits beside
 * the `[id]` one, which Next resolves in favour of the literal path.
 */
import { NextResponse } from 'next/server';
import { defineRoute } from '@/lib/route-handler';
import { createChecklistItemSchema } from '@/server/purchase-orders/checklist-contract';
import {
  createChecklistItem,
  listChecklistItems,
} from '@/server/purchase-orders/checklist-service';

/**
 * Every check, including retired ones — a settings list has to show a retired
 * item to be able to bring it back. `auth: 'viewer'` so a read-only account can
 * see how the checklist is configured; the write below is admin.
 */
export const GET = defineRoute({
  auth: 'viewer',
  tag: 'admin/purchase-orders/checklist-items GET',
  handler: async () => NextResponse.json({ items: await listChecklistItems() }),
});

/** Add a check. Admin — changing what the team must do is a management act. */
export const POST = defineRoute<
  Record<string, never>,
  typeof createChecklistItemSchema._type
>({
  auth: 'admin',
  tag: 'admin/purchase-orders/checklist-items POST',
  schema: createChecklistItemSchema,
  handler: async ({ body, session }) =>
    NextResponse.json(
      { item: await createChecklistItem(body, { actorEmail: session!.email }) },
      { status: 201 },
    ),
});
