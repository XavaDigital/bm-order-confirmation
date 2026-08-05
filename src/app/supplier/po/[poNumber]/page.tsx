import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { purchaseOrders } from '@/db/schema';
import { SupplierPoDetailView } from './view';

export const dynamic = 'force-dynamic';

// Never let search engines index supplier portal URLs.
export const metadata = { title: 'Supplier Portal', robots: { index: false, follow: false } };

type Props = { params: Promise<{ poNumber: string }> };

/**
 * The pretty per-PO URL (/supplier/po/PO-2607-DY01-DYNASTY). The URL does not
 * carry the supplier code the API routes need, so this server component looks
 * it up by PO number — a read-only routing hint, NOT an auth decision: the
 * client view still has to pass /api/supplier/[code]/po/[poNumber], which
 * enforces the cookie gate and supplier ownership.
 *
 * An unknown PO number (or a supplier with no portal code) gets a dummy code
 * rather than a 404, so this page renders the same login card either way and
 * never confirms which PO numbers exist to someone who cannot sign in.
 */
export default async function SupplierPoPage({ params }: Props) {
  const { poNumber: raw } = await params;
  let poNumber = raw;
  try {
    poNumber = decodeURIComponent(raw);
  } catch {
    // Malformed escape — treat the raw segment as the PO number.
  }

  const po = await db.query.purchaseOrders.findFirst({
    where: eq(purchaseOrders.poNumber, poNumber),
    columns: { id: true },
    with: { supplier: { columns: { supplierCode: true } } },
  });

  const code = po?.supplier.supplierCode ?? 'UNKNOWN';
  return <SupplierPoDetailView code={code} poNumber={poNumber} />;
}
