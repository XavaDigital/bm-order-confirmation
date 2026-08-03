import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { getRosterPageOrder } from '@/server/roster/guest-service';
import { readRosterSessionCookie, ROSTER_SESSION_COOKIE } from '@/lib/roster-session';
import { RosterPageView } from './view';

export const dynamic = 'force-dynamic';

// Short typeable URLs still shouldn't be indexed.
export const metadata = { title: 'Team Roster', robots: { index: false, follow: false } };

type Props = {
  params: Promise<{ orderNumber: string }>;
  searchParams: Promise<{ t?: string }>;
};

/**
 * The short-URL team roster page: /roster/<order-number> (David, 2026-08-03).
 * Enabled per order by staff; gated by the page password or a staff-shared
 * ?t= token link; identified by guest email.
 */
export default async function RosterPage({ params, searchParams }: Props) {
  const { orderNumber } = await params;
  const { t } = await searchParams;

  const order = await getRosterPageOrder(decodeURIComponent(orderNumber));
  // Generic 404 — no hint whether the order exists but has no roster page.
  if (!order) notFound();

  const cookieStore = await cookies();
  const existingGuestId = readRosterSessionCookie(
    order,
    cookieStore.get(ROSTER_SESSION_COOKIE)?.value ?? null,
  );

  return (
    <RosterPageView
      orderNumber={order.orderNumber}
      teamLabel={order.clubName ?? order.name ?? order.orderNumber}
      requiresPassword={order.rosterPassword !== null}
      hasSession={existingGuestId !== null}
      token={t ?? null}
    />
  );
}
