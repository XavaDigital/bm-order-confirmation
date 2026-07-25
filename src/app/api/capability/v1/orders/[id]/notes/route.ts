import { NextResponse } from 'next/server';
import { z } from 'zod';
import { addOrderNote } from '@/server/orders/service';
import { defineRoute } from '@/lib/route-handler';

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
      authorLabel: actingUser!,
    });
    return NextResponse.json(note, { status: 201 });
  },
});
