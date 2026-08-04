import { NextResponse } from 'next/server';
import { upsertNameListEntries, NameListFullError } from '@/server/orders/service';
import { upsertNameListSchema } from '@/server/orders/name-list-contract';
import { conflict } from '@/lib/api-responses';
import { defineRoute } from '@/lib/route-handler';

export const POST = defineRoute<{ id: string; garmentId: string }, typeof upsertNameListSchema._type>({
  auth: 'staff',
  tag: 'admin/name-list POST',
  schema: upsertNameListSchema,
  handler: async ({ params, body, session }) => {
    try {
      const entries = await upsertNameListEntries(params.garmentId, body, { actorEmail: session!.email });
      return NextResponse.json({ ok: true, entries });
    } catch (err) {
      // NameListFullError doesn't match the wrapper's *ConflictError suffix —
      // keep its 409 here; NotFoundError falls through to the wrapper.
      if (err instanceof NameListFullError) return conflict(err.message);
      throw err;
    }
  },
});
