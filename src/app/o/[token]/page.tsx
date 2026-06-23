import { notFound } from 'next/navigation';
import { getOrderByToken } from '@/server/orders/service';
import { CustomerOrderView } from './view';

export const dynamic = 'force-dynamic';

/**
 * Customer-facing confirmation page (PROJECT_BRIEF.md §4.2).
 *
 * Server component: token-gated data fetch (the magic-link token alone is
 * sufficient; no token = 404). Rendering is delegated to the client `view.tsx`
 * (BeastMode dark theme). Full flow is build phase 3.
 */
export default async function CustomerOrderPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const order = await getOrderByToken(token);

  // Generic 404 — never reveal whether a token exists (BRIEF §7).
  if (!order) notFound();

  return (
    <CustomerOrderView
      orderNumber={order.orderNumber}
      customerName={order.customerName}
      clubName={order.clubName}
      status={order.status}
      expectedShipDate={order.expectedShipDate}
      deadlineDate={order.deadlineDate}
    />
  );
}
