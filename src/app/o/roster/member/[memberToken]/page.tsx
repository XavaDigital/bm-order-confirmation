import { notFound } from 'next/navigation';
import { signChartRefs } from '@/lib/signed-urls';
import { getRosterForMemberByMemberToken } from '@/server/roster/customer-service';
import { RosterMemberView, type RosterMemberViewProps } from './view';

export const dynamic = 'force-dynamic';

// Never let search engines index individual roster URLs.
export const metadata = { title: 'Your Sizes', robots: { index: false, follow: false } };

type Props = { params: Promise<{ memberToken: string }> };

export default async function CustomerRosterMemberPage({ params }: Props) {
  const { memberToken } = await params;
  const roster = await getRosterForMemberByMemberToken(memberToken);

  if (!roster) notFound();

  const garments: RosterMemberViewProps['roster']['garments'] = await Promise.all(
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
    <RosterMemberView
      memberToken={memberToken}
      roster={{
        orderNumber: roster.order.orderNumber,
        clubName: roster.order.clubName,
        locked: roster.order.locked,
        namesUppercase: roster.order.namesUppercase,
        garments,
        member: {
          ...roster.member,
          submittedAt: roster.member.submittedAt?.toISOString() ?? null,
        },
      }}
    />
  );
}
