/**
 * Shared PO resolver for the supplier export routes (pdf/xlsx): the PO by
 * NUMBER, owned by THIS supplier, and actually sent — draft/approved (and the
 * wrong supplier's numbers) read as absent, matching loadSupplierPoOrThrow in
 * src/server/supplier-portal/service.ts. Latest revision only: the supplier
 * has no business exporting superseded revisions.
 */
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { purchaseOrders } from '@/db/schema';

export async function loadSentPoForExport(supplierId: string, poNumber: string) {
  const po = await db.query.purchaseOrders.findFirst({
    where: eq(purchaseOrders.poNumber, poNumber),
    with: {
      supplier: true,
      revisions: { orderBy: (r, { desc }) => [desc(r.revisionNumber)], limit: 1 },
    },
  });
  if (!po || po.supplierId !== supplierId || po.status === 'draft' || po.status === 'approved') {
    return null;
  }
  return po;
}
