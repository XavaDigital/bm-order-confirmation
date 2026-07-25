import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { defineRoute } from '@/lib/route-handler';

export const POST = defineRoute({
  auth: 'public',
  tag: 'auth/logout POST',
  handler: async () => {
    const session = await getSession();
    session.destroy();
    return NextResponse.json({ ok: true });
  },
});
