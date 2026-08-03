import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  createAcknowledgement,
  listAllAcknowledgements,
} from '@/server/acknowledgements/service';
import { defineRoute } from '@/lib/route-handler';

export const GET = defineRoute({
  auth: 'viewer',
  tag: 'admin/acknowledgements GET',
  handler: async () => NextResponse.json({ items: await listAllAcknowledgements() }),
});

const createSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(2000),
});

export const POST = defineRoute<Record<string, never>, typeof createSchema._type>({
  auth: 'admin',
  tag: 'admin/acknowledgements POST',
  schema: createSchema,
  handler: async ({ body, session }) => {
    const created = await createAcknowledgement(body, { actorEmail: session!.email });
    return NextResponse.json(created, { status: 201 });
  },
});
