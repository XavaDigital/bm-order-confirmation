import { Suspense } from 'react';
import { OrdersView } from './OrdersView';

export default function OrdersPage() {
  return (
    <Suspense>
      <OrdersView />
    </Suspense>
  );
}
