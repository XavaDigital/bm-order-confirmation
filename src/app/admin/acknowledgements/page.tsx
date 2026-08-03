import { getSession } from '@/lib/session';
import { AcknowledgementsView } from './AcknowledgementsView';

export default async function AcknowledgementsPage() {
  const session = await getSession();
  return <AcknowledgementsView canMutate={session.role === 'admin'} />;
}

// Tab title: "OrderFlow - Acknowledgments" (root layout template).
export const metadata = { title: 'Acknowledgments' };
