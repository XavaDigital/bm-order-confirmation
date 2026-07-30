import { NextResponse } from 'next/server';
import { defineRoute } from '@/lib/route-handler';
import { listHubCustomerContacts } from '@/server/hub/client';

/**
 * Browser-facing proxy for the hub's contact picker (fleet convention: the
 * browser never holds the capability bearer). Returns [] when the hub seam is
 * off or unreachable — the picker just renders empty, like customer search.
 */
export const GET = defineRoute<{ id: string }>({
  auth: 'viewer',
  tag: 'admin/hub/contacts GET',
  handler: async ({ params }) =>
    NextResponse.json({ contacts: await listHubCustomerContacts(params.id) }),
});
