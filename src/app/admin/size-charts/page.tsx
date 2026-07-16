import { getSession } from '@/lib/session';
import { SizeChartsView } from './SizeChartsView';

export default async function SizeChartsPage() {
  const session = await getSession();
  return <SizeChartsView role={session.role} />;
}
