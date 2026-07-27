import { NextResponse } from 'next/server';
import { addOrderNote, listOrderNotes, type NoteScope } from '@/server/orders/notes-service';
import { createOrderNoteSchema } from '@/server/orders/notes-contract';
import { defineRoute } from '@/lib/route-handler';

/**
 * The staff note thread on an order.
 *
 * `?garmentId=<uuid>` reads that garment's thread; `?scope=all` reads every note
 * on the order including its garments' (for a combined view); the default is the
 * order-wide thread only.
 *
 * `auth: 'staff'` on both, not `'admin'`: notes are how sales and production talk
 * to each other, so the `canMutate = role === 'admin'` convention would defeat
 * the feature. Per-note edit/delete permission is enforced in the service.
 */
export const GET = defineRoute<{ id: string }>({
  auth: 'staff',
  tag: 'admin/orders/[id]/notes GET',
  handler: async ({ params, request }) => {
    const url = new URL(request.url);
    const garmentId = url.searchParams.get('garmentId');
    const scope: NoteScope = garmentId
      ? { garmentId }
      : url.searchParams.get('scope') === 'all'
        ? 'all'
        : 'order';

    return NextResponse.json(await listOrderNotes(params.id, scope));
  },
});

export const POST = defineRoute<{ id: string }, typeof createOrderNoteSchema._type>({
  auth: 'staff',
  tag: 'admin/orders/[id]/notes POST',
  schema: createOrderNoteSchema,
  handler: async ({ params, body, session }) => {
    const note = await addOrderNote(
      params.id,
      {
        body: body.body,
        garmentId: body.garmentId ?? null,
        authorKind: 'staff',
        authorLabel: session!.email,
        isHtml: true,
      },
      { actorEmail: session!.email, actorStaffUserId: session!.userId },
    );
    return NextResponse.json(note, { status: 201 });
  },
});
