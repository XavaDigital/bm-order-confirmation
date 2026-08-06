import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  cancelStatusReminder,
  createStatusReminder,
  listStatusReminders,
} from '@/server/workflow/status-reminders';
import { boardKeySchema } from '@/server/workflow/contract';
import { ORDER_STATUS } from '@/lib/status';
import { PO_STATUSES } from '@/server/purchase-orders/contract';
import { isAdmin } from '@/lib/roles';
import { badRequest } from '@/lib/api-responses';
import { defineRoute } from '@/lib/route-handler';

const ORDER_STATUS_KEYS = Object.keys(ORDER_STATUS);

/**
 * Conditional reminders: a note attached to one order/PO that fires when it
 * reaches a chosen status (see `server/workflow/status-reminders.ts`).
 */
const createSchema = z
  .object({
    boardKey: boardKeySchema,
    entityId: z.string().uuid(),
    triggerStatus: z.string().trim().min(1).max(64),
    note: z.string().trim().min(1).max(500),
  })
  .refine(
    (v) =>
      v.boardKey === 'order'
        ? ORDER_STATUS_KEYS.includes(v.triggerStatus)
        : (PO_STATUSES as readonly string[]).includes(v.triggerStatus),
    { message: 'Not a valid status for this board', path: ['triggerStatus'] },
  );

const deleteSchema = z.object({ id: z.string().uuid() });

export const GET = defineRoute({
  auth: 'viewer',
  tag: 'admin/workflow/status-reminders GET',
  handler: async ({ request }) => {
    const url = new URL(request.url);
    const board = boardKeySchema.safeParse(url.searchParams.get('boardKey') ?? 'order');
    const entityId = url.searchParams.get('entityId');
    if (!board.success) return badRequest(board.error);
    if (!entityId) return NextResponse.json({ error: 'entityId is required' }, { status: 400 });

    return NextResponse.json(await listStatusReminders(board.data, entityId));
  },
});

export const POST = defineRoute<Record<string, never>, typeof createSchema._type>({
  auth: 'staff',
  tag: 'admin/workflow/status-reminders POST',
  schema: createSchema,
  handler: async ({ body, session }) =>
    NextResponse.json(
      await createStatusReminder(
        body.boardKey,
        body.entityId,
        body.triggerStatus,
        body.note,
        session!.userId,
      ),
    ),
});

export const DELETE = defineRoute<Record<string, never>, typeof deleteSchema._type>({
  auth: 'staff',
  tag: 'admin/workflow/status-reminders DELETE',
  schema: deleteSchema,
  handler: async ({ body, session }) => {
    await cancelStatusReminder(body.id, {
      staffUserId: session!.userId,
      isAdmin: isAdmin(session!.role),
    });
    return NextResponse.json({ ok: true });
  },
});
