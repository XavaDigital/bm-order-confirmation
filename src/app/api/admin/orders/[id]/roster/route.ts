import { NextResponse } from 'next/server';
import { getRoster } from '@/server/roster/service';
import { defineRoute } from '@/lib/route-handler';

export const GET = defineRoute<{ id: string }>({
  auth: 'staff',
  tag: 'admin/roster GET',
  handler: async ({ params }) => NextResponse.json(await getRoster(params.id)),
});
