import { getSession } from '@/lib/session';
import { SuppliersView } from './SuppliersView';

export default async function SuppliersPage() {
  const session = await getSession();
  return <SuppliersView role={session.role} />;
}

// Tab title: "OrderFlow - Suppliers" (root layout template).
export const metadata = { title: 'Suppliers' };
