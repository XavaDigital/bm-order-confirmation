import { NextResponse } from 'next/server';
import { defineRoute } from '@/lib/route-handler';
import { resolveSupplierPoViewByNumber } from '@/server/supplier-portal/service';
import { requireSupplier } from '../../_shared';

/**
 * One PO's full portal view (snapshot + comments), for the detail page.
 * `?rev=N` serves revision N's snapshot instead of the latest — the revision
 * stepper fetches neighbouring revisions through this to highlight changes.
 * An unknown or malformed rev answers 404, same as an unknown PO.
 */
export const GET = defineRoute<{ code: string; poNumber: string }>({
  auth: 'public',
  tag: 'supplier/po GET',
  handler: async ({ request, params }) => {
    const gate = await requireSupplier(request, params.code);
    if (!gate.ok) return gate.response;

    const revParam = new URL(request.url).searchParams.get('rev');
    let revisionNumber: number | undefined;
    if (revParam !== null) {
      const parsed = Number(revParam);
      if (!Number.isInteger(parsed) || parsed < 1) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      revisionNumber = parsed;
    }

    try {
      const view = await resolveSupplierPoViewByNumber(
        gate.supplier.id,
        params.poNumber,
        revisionNumber,
      );
      return NextResponse.json({ view, name: gate.personName });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'error';
      if (msg === 'po_not_found' || msg === 'revision_not_found') {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      throw err;
    }
  },
});
