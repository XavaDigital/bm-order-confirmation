import { getSession } from '@/lib/session';
import { GarmentTypesView } from './GarmentTypesView';

export default async function GarmentTypesPage() {
  const session = await getSession();
  return <GarmentTypesView role={session.role} />;
}

// Tab title: "OrderFlow - Garment Types" (root layout template).
export const metadata = { title: 'Garment Types' };
