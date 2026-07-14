import { NextRequest, NextResponse } from 'next/server';
import { getRosterForMemberByMemberToken } from '@/server/roster/customer-service';

type Params = { params: Promise<{ memberToken: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { memberToken } = await params;
  const roster = await getRosterForMemberByMemberToken(memberToken);

  if (!roster) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json(roster);
}
