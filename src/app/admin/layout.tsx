import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { checkAccess } from '@/server/auth/access';
import { canRead } from '@/lib/roles';
import { AppShell } from '@/components/admin/AppShell';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  // Belt-and-suspenders: middleware handles the redirect, but guard here too.
  if (!session.userId) {
    redirect('/login');
  }

  /**
   * Re-read the grant from identity (cached ≤60s) on every page load.
   *
   * Fleet access contract: a revoked or lowered grant has to take effect on a
   * LIVE session, not just at the next sign-in. Identity answering "no access"
   * ends the session here and now; identity being unreachable serves the last
   * known good role, because an identity outage must not log out the company.
   */
  const access = await checkAccess({
    staffUserId: session.userId,
    identityUserId: session.identityUserId ?? null,
    sessionRole: session.role ?? 'none',
  });

  if (!access.ok || !canRead(access.role)) {
    session.destroy();
    redirect(`/login?denied=${access.ok ? 'no_access' : access.reason}`);
  }

  // The freshly-read role, never the one cached in the cookie — the nav and the
  // per-page controls must reflect a downgrade immediately.
  session.role = access.role;

  return (
    <AppShell user={{ name: session.name, email: session.email, role: access.role }}>
      {children}
    </AppShell>
  );
}
