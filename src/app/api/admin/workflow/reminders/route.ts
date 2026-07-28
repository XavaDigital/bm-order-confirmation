import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  clearReminder,
  listRemindersForUser,
  upsertReminder,
} from '@/server/workflow/scans';
import { boardKeySchema } from '@/server/workflow/contract';
import { defineRoute } from '@/lib/route-handler';

/**
 * Snoozes and reminders for the signed-in user.
 *
 * Always scoped to `session.userId`: a snooze is personal, so there is no
 * staffUserId in the payload for one person to aim at another.
 */
const upsertSchema = z.object({
  entityType: boardKeySchema,
  entityId: z.string().uuid(),
  kind: z.enum(['snooze', 'reminder']),
  /** ISO timestamp. Must be in the future — a past due date fires immediately. */
  dueAt: z.string().datetime(),
  note: z.string().trim().max(500).nullish(),
});

const clearSchema = z.object({
  entityType: boardKeySchema,
  entityId: z.string().uuid(),
  kind: z.enum(['snooze', 'reminder']),
});

export const GET = defineRoute({
  auth: 'viewer',
  tag: 'admin/workflow/reminders GET',
  handler: async ({ session }) =>
    NextResponse.json(await listRemindersForUser(session!.userId)),
});

export const PUT = defineRoute<Record<string, never>, typeof upsertSchema._type>({
  auth: 'staff',
  tag: 'admin/workflow/reminders PUT',
  schema: upsertSchema,
  handler: async ({ body, session }) => {
    await upsertReminder(
      body.entityType,
      body.entityId,
      session!.userId,
      body.kind,
      new Date(body.dueAt),
      body.note ?? null,
    );
    return NextResponse.json({ ok: true });
  },
});

export const DELETE = defineRoute<Record<string, never>, typeof clearSchema._type>({
  auth: 'staff',
  tag: 'admin/workflow/reminders DELETE',
  schema: clearSchema,
  handler: async ({ body, session }) => {
    await clearReminder(body.entityType, body.entityId, session!.userId, body.kind);
    return NextResponse.json({ ok: true });
  },
});
