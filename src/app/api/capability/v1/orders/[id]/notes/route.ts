import { NextResponse } from 'next/server';
import { z } from 'zod';
import { addOrderNote, listOrderNotes } from '@/server/orders/notes-service';
import { defineRoute } from '@/lib/route-handler';
import { resolveActingUserLabel } from '@/server/identity/client';

const noteSchema = z.object({
  body: z.string().trim().min(1).max(5000),
});

/**
 * Email Flow adds an ORDER NOTE — a finalisation point ("sleeves 1cm shorter",
 * "numbers inside the hem"), David's 2026-08-04 distinction — not a thread
 * comment. Same guard as the sibling capability route.
 */
export const POST = defineRoute<{ id: string }, typeof noteSchema._type>({
  auth: 'capability',
  tag: 'capability/orders/[id]/notes POST',
  schema: noteSchema,
  handler: async ({ params, body, actingUser }) => {
    const note = await addOrderNote(params.id, {
      body: body.body,
      kind: 'note',
      authorKind: 'email_flow',
      // X-Acting-User is an identity-service UUID, which read as a wall of hex
      // in the note thread. Resolve it to a person when the identity seam is
      // configured; fall back to the raw id when it is not, which is the same
      // behaviour as before.
      authorLabel: await resolveActingUserLabel(actingUser!),
    });
    return NextResponse.json(note, { status: 201 });
  },
});

/**
 * Email Flow reads the order notes — the current live list, not the lossy
 * timeline echo. Comments (the discussion thread) are deliberately not on
 * this surface yet (David, 2026-08-04: "could come later").
 */
export const GET = defineRoute<{ id: string }>({
  auth: 'capability',
  tag: 'capability/orders/[id]/notes GET',
  handler: async ({ params }) => {
    const notes = await listOrderNotes(params.id, 'all', { kind: 'note' });
    return NextResponse.json({
      items: notes
        .filter((n) => !n.deleted)
        .map((n) => ({
          id: n.id,
          body: n.body,
          authorLabel: n.authorLabel,
          authorKind: n.authorKind,
          createdAt: n.createdAt,
        })),
    });
  },
});
