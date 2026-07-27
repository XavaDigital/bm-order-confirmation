import { NextResponse } from 'next/server';
import { deleteOrderNote, updateOrderNote } from '@/server/orders/notes-service';
import { updateOrderNoteSchema } from '@/server/orders/notes-contract';
import { defineRoute } from '@/lib/route-handler';

/**
 * Edit or remove one note.
 *
 * `auth: 'staff'` with the real check in the service: editing is author-only,
 * deleting is author-or-admin. Doing it there rather than here keeps the rule in
 * one place for every caller, and lets it read the note's actual author.
 */
export const PATCH = defineRoute<
  { id: string; noteId: string },
  typeof updateOrderNoteSchema._type
>({
  auth: 'staff',
  tag: 'admin/orders/[id]/notes/[noteId] PATCH',
  schema: updateOrderNoteSchema,
  handler: async ({ params, body, session }) =>
    NextResponse.json(
      await updateOrderNote(params.id, params.noteId, body.body, {
        actorEmail: session!.email,
        actorStaffUserId: session!.userId,
        isAdmin: session!.role === 'admin',
      }),
    ),
});

export const DELETE = defineRoute<{ id: string; noteId: string }>({
  auth: 'staff',
  tag: 'admin/orders/[id]/notes/[noteId] DELETE',
  handler: async ({ params, session }) => {
    await deleteOrderNote(params.id, params.noteId, {
      actorEmail: session!.email,
      actorStaffUserId: session!.userId,
      isAdmin: session!.role === 'admin',
    });
    return NextResponse.json({ ok: true });
  },
});
