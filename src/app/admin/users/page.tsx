import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { UsersView } from './UsersView';

export default async function UsersPage() {
  const session = await getSession();

  if (!session.userId) redirect('/login');
  if (session.role !== 'admin') redirect('/admin/dashboard');

  return <UsersView currentUserId={session.userId} />;
}
