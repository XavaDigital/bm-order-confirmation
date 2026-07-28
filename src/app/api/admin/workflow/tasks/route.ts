import { NextResponse } from 'next/server';
import { z } from 'zod';
import { confirmTask, reopenTask } from '@/server/workflow/tasks';
import { boardKeySchema } from '@/server/workflow/contract';
import { defineRoute } from '@/lib/route-handler';

const confirmSchema = z.object({
  boardKey: boardKeySchema,
  entityId: z.string().uuid(),
  taskId: z.string().uuid(),
  note: z.string().trim().max(500).nullish(),
});

const reopenSchema = z.object({
  boardKey: boardKeySchema,
  entityId: z.string().uuid(),
  taskId: z.string().uuid(),
});

/**
 * Confirm a task. Staff-level and attributed to the signed-in user, which is
 * what makes an `all` policy meaningful — a shared "mark done" button would make
 * "everyone has confirmed" unanswerable.
 */
export const POST = defineRoute<Record<string, never>, typeof confirmSchema._type>({
  auth: 'staff',
  tag: 'admin/workflow/tasks POST',
  schema: confirmSchema,
  handler: async ({ body, session }) =>
    NextResponse.json(
      await confirmTask(body.boardKey, body.entityId, body.taskId, {
        actorEmail: session!.email,
        actorStaffUserId: session!.userId,
        note: body.note ?? null,
      }),
    ),
});

/**
 * Undo a confirmation. `auth: 'admin'` — reopening moves work backwards in
 * everyone else's view, and the case for it is correcting someone else's entry.
 */
export const DELETE = defineRoute<Record<string, never>, typeof reopenSchema._type>({
  auth: 'admin',
  tag: 'admin/workflow/tasks DELETE',
  schema: reopenSchema,
  handler: async ({ body, session }) => {
    await reopenTask(body.boardKey, body.entityId, body.taskId, {
      actorEmail: session!.email,
      actorStaffUserId: session!.userId,
      isAdmin: true,
    });
    return NextResponse.json({ ok: true });
  },
});
