import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createColorBook, listColorBooks } from '@/server/suppliers/service';
import { defineRoute } from '@/lib/route-handler';

/**
 * A supplier's colour books (David, 2026-08-05). Newest first — the first row
 * is the default for new POs. Books are added as new editions arrive and
 * never deleted (old POs and reprints reference them).
 */
export const GET = defineRoute<{ id: string }>({
  auth: 'viewer',
  tag: 'suppliers/[id]/color-books GET',
  handler: async ({ params }) => NextResponse.json({ items: await listColorBooks(params.id) }),
});

const createSchema = z.object({ name: z.string().trim().min(1).max(120) });

export const POST = defineRoute<{ id: string }, typeof createSchema._type>({
  auth: 'staff',
  tag: 'suppliers/[id]/color-books POST',
  schema: createSchema,
  handler: async ({ params, body, session }) => {
    const book = await createColorBook(params.id, body.name, {
      actorStaffUserId: session!.userId,
    });
    return NextResponse.json(book, { status: 201 });
  },
});
