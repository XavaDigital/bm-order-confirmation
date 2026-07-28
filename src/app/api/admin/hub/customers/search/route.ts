import { NextResponse } from 'next/server';
import { searchHubCustomers } from '@/server/hub/client';
import { defineRoute } from '@/lib/route-handler';

/**
 * Server-side proxy for the hub customer typeahead — the browser never calls
 * the hub directly (the Capability API has no CORS by design).
 */
export const GET = defineRoute({
  auth: 'viewer',
  tag: 'hub/customers/search GET',
  handler: async ({ request }) => {
    const q = request.nextUrl.searchParams.get('q') ?? '';
    return NextResponse.json(await searchHubCustomers(q));
  },
});
