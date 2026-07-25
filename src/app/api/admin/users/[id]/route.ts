import { NextResponse } from 'next/server';
import { z } from 'zod';
import { updateUser, deleteUser, UserNotFoundError, LastAdminError } from '@/server/users/service';
import { defineRoute } from '@/lib/route-handler';
import { logger } from '@/lib/logger';

const patchSchema = z.object({
  role: z.enum(['sales', 'admin']).optional(),
  isActive: z.boolean().optional(),
}).refine((d) => d.role !== undefined || d.isActive !== undefined, {
  message: 'At least one of role or isActive must be provided',
});

export const PATCH = defineRoute<{ id: string }, typeof patchSchema._type>({
  auth: 'admin',
  tag: 'admin/users PATCH',
  schema: patchSchema,
  handler: async ({ params, body, session }) => {
    // Prevent self-modification of role/status.
    if (params.id === session!.userId) {
      return NextResponse.json({ error: 'You cannot modify your own role or status' }, { status: 400 });
    }

    try {
      const user = await updateUser(params.id, body);
      return NextResponse.json(user);
    } catch (err) {
      // LastAdminError's name doesn't match the wrapper's *ConflictError mapping.
      if (err instanceof LastAdminError) {
        return NextResponse.json({ error: err.message }, { status: 409 });
      }
      throw err;
    }
  },
});

export const DELETE = defineRoute<{ id: string }>({
  auth: 'admin',
  tag: 'admin/users DELETE',
  handler: async ({ params, session }) => {
    if (params.id === session!.userId) {
      return NextResponse.json({ error: 'You cannot delete your own account' }, { status: 400 });
    }

    try {
      await deleteUser(params.id);
      return NextResponse.json({ ok: true });
    } catch (err) {
      if (err instanceof UserNotFoundError) throw err; // wrapper maps to 404
      // Surfaces the "only pending invited users can be deleted" message to the UI.
      logger.error('[admin/users DELETE]', err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Internal server error' },
        { status: 500 },
      );
    }
  },
});
