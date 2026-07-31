import { NextResponse } from 'next/server';
import { defineRoute } from '@/lib/route-handler';
import { listHubCustomerProjects } from '@/server/hub/client';

/**
 * Browser-facing proxy for the design-project link picker (fleet convention:
 * the browser never holds the capability bearer). Returns [] when the hub
 * seam is off or unreachable — the picker just renders empty.
 */
export const GET = defineRoute<{ id: string }>({
  auth: 'viewer',
  tag: 'admin/hub/projects GET',
  handler: async ({ params }) =>
    NextResponse.json({ projects: await listHubCustomerProjects(params.id) }),
});
