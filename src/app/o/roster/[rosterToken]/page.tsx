import { notFound } from 'next/navigation';
import { signChartRefs } from '@/lib/signed-urls';
import { getRosterForMember } from '@/server/roster/customer-service';
import { RosterCustomerView, type RosterCustomerViewProps } from './view';

export const dynamic = 'force-dynamic';

// Never let search engines index shared roster URLs.
export const metadata = { title: 'Team Roster', robots: { index: false, follow: false } };

type Props = { params: Promise<{ rosterToken: string }> };

export default async function CustomerRosterPage({ params }: Props) {
  const { rosterToken } = await params;
  const roster = await getRosterForMember(rosterToken);

  if (!roster) notFound();

  const garments: RosterCustomerViewProps['roster']['garments'] = await Promise.all(
    roster.order.garments.map(async (garment) => ({
      id: garment.id,
      name: garment.name,
      notes: garment.notes,
      sizes: garment.sizes,
      sizeCharts: await signChartRefs(garment.sizeCharts),
      nameListEnabled: garment.nameListEnabled,
      nameListRows: garment.nameListRows,
      nameListEntries: garment.nameListEntries,
    })),
  );

  return (
    <RosterCustomerView
      rosterToken={rosterToken}
      roster={{
        orderNumber: roster.order.orderNumber,
        clubName: roster.order.clubName,
        locked: roster.order.locked,
        namesUppercase: roster.order.namesUppercase,
        garments,
        members: roster.members.map((member) => ({
          ...member,
          submittedAt: member.submittedAt?.toISOString() ?? null,
        })),
      }}
    />
  );
}
