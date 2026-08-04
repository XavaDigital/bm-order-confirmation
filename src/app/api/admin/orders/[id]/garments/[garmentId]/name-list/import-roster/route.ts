import { NextResponse } from 'next/server';
import { importNameListFromRoster, NameListFullError } from '@/server/orders/service';
import { conflict } from '@/lib/api-responses';
import { defineRoute } from '@/lib/route-handler';

export const POST = defineRoute<{ id: string; garmentId: string }>({
  auth: 'staff',
  tag: 'admin/name-list/import-roster POST',
  handler: async ({ params, session }) => {
    try {
      const result = await importNameListFromRoster(params.garmentId, { actorEmail: session!.email });
      return NextResponse.json({ ok: true, ...result });
    } catch (err) {
      if (err instanceof NameListFullError) return conflict(err.message);
      throw err;
    }
  },
});
