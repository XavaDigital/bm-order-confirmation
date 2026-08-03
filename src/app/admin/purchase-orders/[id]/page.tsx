import { PoDetailView } from './PoDetailView';

export default async function PurchaseOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PoDetailView poId={id} />;
}

// Tab title: "OrderFlow - Purchase Order" (root layout template).
export const metadata = { title: 'Purchase Order' };
