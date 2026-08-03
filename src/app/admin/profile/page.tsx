import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { ProfileView } from './ProfileView';

export default async function ProfilePage() {
  const session = await getSession();
  if (!session.userId) redirect('/login');

  return (
    <ProfileView
      user={{ name: session.name, email: session.email, role: session.role }}
    />
  );
}

// Tab title: "OrderFlow - Profile" (root layout template).
export const metadata = { title: 'Profile' };
