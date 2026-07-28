import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getUnreadCount, listInbox, markInboxRead } from '@/server/notifications/dispatch';
import { defineRoute } from '@/lib/route-handler';

/**
 * The signed-in user's notification inbox.
 *
 * Every read and write is scoped to `session.userId` server-side — the client
 * never names whose inbox it wants, so there is no id to tamper with.
 */
export const GET = defineRoute({
  auth: 'staff',
  tag: 'admin/inbox GET',
  handler: async ({ request, session }) => {
    const url = new URL(request.url);
    const unreadOnly = url.searchParams.get('unreadOnly') === '1';
    const limit = Number(url.searchParams.get('limit') ?? '30');

    const [items, unreadCount] = await Promise.all([
      listInbox(session!.userId, {
        unreadOnly,
        limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 30,
      }),
      getUnreadCount(session!.userId),
    ]);

    return NextResponse.json({ items, unreadCount });
  },
});

const markReadSchema = z.preprocess(
  (value) => value ?? {},
  z.object({
    /** Omit to mark everything read. */
    itemIds: z.array(z.string().uuid()).max(200).optional(),
  }),
);

export const POST = defineRoute<Record<string, never>, typeof markReadSchema._type>({
  auth: 'staff',
  tag: 'admin/inbox POST',
  schema: markReadSchema,
  handler: async ({ body, session }) => {
    const marked = await markInboxRead(session!.userId, body.itemIds);
    return NextResponse.json({ marked, unreadCount: await getUnreadCount(session!.userId) });
  },
});
