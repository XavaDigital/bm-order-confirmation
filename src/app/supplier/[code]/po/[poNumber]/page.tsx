import { SupplierPoDetailView } from './view';

export const dynamic = 'force-dynamic';

// Never let search engines index supplier portal URLs.
export const metadata = { title: 'Supplier Portal', robots: { index: false, follow: false } };

type Props = { params: Promise<{ code: string; poNumber: string }> };

/**
 * The pretty per-PO URL (David, 2026-08-05: /supplier/{CODE}/po/{PO#}). Both
 * segments come straight from the path — no lookup, no auth decision here.
 * The client view calls /api/supplier/[code]/po/[poNumber], which enforces
 * the cookie gate and supplier ownership; an unknown code or number renders
 * the same login card as a real one, so the page never confirms which PO
 * numbers exist to someone who cannot sign in.
 */
export default async function SupplierPoPage({ params }: Props) {
  const { code: rawCode, poNumber: rawPoNumber } = await params;
  const decode = (segment: string) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment; // malformed escape — use the raw segment
    }
  };
  return <SupplierPoDetailView code={decode(rawCode)} poNumber={decode(rawPoNumber)} />;
}
