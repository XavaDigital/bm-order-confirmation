import { Suspense } from 'react';
import { OrdersView } from './OrdersView';

export default function OrdersPage() {
  return (
    <Suspense>
      <OrdersView />
    </Suspense>
  );
}

// Tab title: "OrderFlow - Orders" (root layout template).
export const metadata = { title: 'Orders' };
