import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Liveness probe for App Runner / load balancers.
export function GET() {
  return NextResponse.json({ status: 'ok' });
}
