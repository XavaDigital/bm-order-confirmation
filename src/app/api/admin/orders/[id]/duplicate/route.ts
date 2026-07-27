import { NextResponse } from 'next/server';
import { z } from 'zod';
import { duplicateOrder } from '@/server/orders/service';
import { defineRoute } from '@/lib/route-handler';

/**
 * Duplicate an order, optionally as a REPRINT.
 *
 * A reprint records `sourceOrderId`, so the link is queryable and the factory
 * documents can name the previous job to reuse the layout from. A plain
 * duplicate deliberately records nothing, so an unrelated copy never claims to
 * be a reprint. The body is optional — a bare POST still means plain duplicate.
 */
const duplicateOrderSchema = z.preprocess(
  (value) => value ?? {},
  z.object({
    reprint: z.boolean().optional().default(false),
    reprintReason: z.string().trim().max(500).nullish(),
  }),
);

export const POST = defineRoute<{ id: string }, typeof duplicateOrderSchema._type>({
  auth: 'staff',
  tag: 'orders/[id]/duplicate POST',
  schema: duplicateOrderSchema,
  handler: async ({ params, body, session }) => {
    const result = await duplicateOrder(params.id, session!.userId, {
      actorEmail: session!.email,
      reprint: body.reprint,
      reprintReason: body.reprintReason ?? null,
    });
    return NextResponse.json(result, { status: 201 });
  },
});
