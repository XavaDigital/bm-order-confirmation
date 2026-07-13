import { NextRequest, NextResponse } from 'next/server';
import { getRosterForMember } from '@/server/roster/customer-service';

type Params = { params: Promise<{ rosterToken: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { rosterToken } = await params;
  const roster = await getRosterForMember(rosterToken);

  if (!roster) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json(roster);
}
