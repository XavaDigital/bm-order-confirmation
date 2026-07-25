import { NextResponse } from 'next/server';
import { isHubConfigured } from '@/server/hub/client';
import { defineRoute } from '@/lib/route-handler';

/** Lets the admin UI decide whether to render hub-customer controls. */
export const GET = defineRoute({
  auth: 'staff',
  tag: 'hub/status GET',
  handler: async () => NextResponse.json({ configured: isHubConfigured() }),
});
