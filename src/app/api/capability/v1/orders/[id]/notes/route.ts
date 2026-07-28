import { NextResponse } from 'next/server';
import { z } from 'zod';
import { addOrderNote } from '@/server/orders/notes-service';
import { defineRoute } from '@/lib/route-handler';
import { getIdentityUser, isIdentityConfigured } from '@/server/identity/client';

/**
 * Turn an acting-user UUID into something a human recognises.
 *
 * Best-effort by design: a slow or unreachable identity service must not stop a
 * note being written, so any failure falls back to the id.
 */
async function resolveActingUserLabel(actingUser: string): Promise<string> {
  if (!isIdentityConfigured()) return actingUser;
  const user = await getIdentityUser(actingUser);
  if (user === null || user === 'gone') return actingUser;
  return user.name ?? user.email ?? actingUser;
}

const noteSchema = z.object({
  body: z.string().trim().min(1).max(5000),
});

/**
 * Email Flow adds a staff-only note to an order (e.g. from the inbox while
 * reading the customer's email). Same guard as the sibling capability route.
 */
export const POST = defineRoute<{ id: string }, typeof noteSchema._type>({
  auth: 'capability',
  tag: 'capability/orders/[id]/notes POST',
  schema: noteSchema,
  handler: async ({ params, body, actingUser }) => {
    const note = await addOrderNote(params.id, {
      body: body.body,
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
