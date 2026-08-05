import { NextResponse } from 'next/server';
import { z } from 'zod';
import { defineRoute } from '@/lib/route-handler';
import {
  addPoFileComment,
  softDeletePoFile,
} from '@/server/purchase-orders/files-service';

const commentSchema = z.object({ body: z.string().trim().min(1).max(2000) });

/** Staff comment on one production file's thread (always shared — the supplier reads it). */
export const POST = defineRoute<{ id: string; fileId: string }, typeof commentSchema._type>({
  auth: 'staff',
  tag: 'purchase-orders/[id]/files/[fileId] POST',
  schema: commentSchema,
  handler: async ({ params, body, session }) => {
    const note = await addPoFileComment(params.id, params.fileId, body.body, {
      authorKind: 'staff',
      authorLabel: session!.email,
      actorStaffUserId: session!.userId,
      actorEmail: session!.email,
    });
    return NextResponse.json(note, { status: 201 });
  },
});

/** Hide a mistaken upload. The stored object is never deleted (files kept forever). */
export const DELETE = defineRoute<{ id: string; fileId: string }>({
  auth: 'staff',
  tag: 'purchase-orders/[id]/files/[fileId] DELETE',
  handler: async ({ params, session }) => {
    await softDeletePoFile(params.id, params.fileId, { actorEmail: session!.email });
    return NextResponse.json({ ok: true });
  },
});
