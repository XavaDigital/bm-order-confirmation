import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getRosterPageSettings, setRosterPage } from '@/server/orders/service';
import { defineRoute } from '@/lib/route-handler';

/** The short-URL roster page's settings — enabled flag + readable password. */
export const GET = defineRoute<{ id: string }>({
  auth: 'staff',
  tag: 'orders/[id]/roster/page-settings GET',
  handler: async ({ params }) => NextResponse.json(await getRosterPageSettings(params.id)),
});

const patchSchema = z.object({
  enabled: z.boolean().optional(),
  /** null clears the password (page opens without one); min 4 when set. */
  password: z.string().trim().min(4).max(64).nullable().optional(),
});

export const PATCH = defineRoute<{ id: string }, typeof patchSchema._type>({
  auth: 'staff',
  tag: 'orders/[id]/roster/page-settings PATCH',
  schema: patchSchema,
  handler: async ({ params, body, session }) => {
    const result = await setRosterPage(params.id, body, { actorEmail: session!.email });
    return NextResponse.json(result);
  },
});
