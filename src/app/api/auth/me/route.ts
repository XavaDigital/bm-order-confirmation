import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { defineRoute } from '@/lib/route-handler';

// Stays 'public': the login flow probes this endpoint, and the 401 body
// ('Unauthenticated') differs from the wrapper's staff-gate response.
export const GET = defineRoute({
  auth: 'public',
  tag: 'auth/me GET',
  handler: async () => {
    const session = await getSession();

    if (!session.userId) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }

    return NextResponse.json({
      user: {
        id: session.userId,
        email: session.email,
        name: session.name,
        role: session.role,
      },
    });
  },
});
