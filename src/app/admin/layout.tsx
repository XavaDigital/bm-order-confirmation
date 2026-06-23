import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { AppShell } from '@/components/admin/AppShell';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  // Belt-and-suspenders: middleware handles the redirect, but guard here too.
  if (!session.userId) {
    redirect('/login');
  }

  return (
    <AppShell user={{ name: session.name, email: session.email, role: session.role }}>
      {children}
    </AppShell>
  );
}
