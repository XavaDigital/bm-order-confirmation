import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

export async function GET() {
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
}
