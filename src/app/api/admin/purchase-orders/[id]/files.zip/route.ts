import { NextResponse } from 'next/server';
import { defineRoute } from '@/lib/route-handler';
import { buildPoZip } from '@/server/purchase-orders/files-service';

/** The same all-files bundle the supplier portal serves, for staff. */
export const GET = defineRoute<{ id: string }>({
  auth: 'viewer',
  tag: 'purchase-orders/[id]/files.zip GET',
  handler: async ({ params }) => {
    const { fileName, data } = await buildPoZip(params.id);
    return new NextResponse(new Uint8Array(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store',
      },
    });
  },
});
