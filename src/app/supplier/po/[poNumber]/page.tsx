import { eq } from 'drizzle-orm';
import { permanentRedirect } from 'next/navigation';
import { db } from '@/db';
import { purchaseOrders } from '@/db/schema';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ poNumber: string }> };

/**
 * LEGACY path shape. The per-PO URL moved to /supplier/{CODE}/po/{PO#}
 * (David, 2026-08-05) hours after this form first shipped — this stub keeps
 * any link already sent working with a permanent redirect.
 *
 * The code lookup is a routing hint, not an auth decision: the target page
 * shows the same login card for real and unknown POs alike, so redirecting an
 * unknown number with a placeholder code leaks nothing.
 */
export default async function LegacySupplierPoPage({ params }: Props) {
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
  permanentRedirect(`/supplier/${encodeURIComponent(code)}/po/${encodeURIComponent(poNumber)}`);
}
