import { NextResponse } from 'next/server';
import { z } from 'zod';
import { updateAcknowledgement } from '@/server/acknowledgements/service';
import { defineRoute } from '@/lib/route-handler';

const patchSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  body: z.string().trim().min(1).max(2000).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export const PATCH = defineRoute<{ id: string }, typeof patchSchema._type>({
  auth: 'admin',
  tag: 'admin/acknowledgements PATCH',
  schema: patchSchema,
  handler: async ({ params, body, session }) => {
    const updated = await updateAcknowledgement(params.id, body, { actorEmail: session!.email });
    return NextResponse.json(updated);
  },
});
