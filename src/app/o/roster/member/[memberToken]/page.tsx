import { notFound } from 'next/navigation';
import { getSignedUrl } from '@/lib/storage';
import { getRosterForMemberByMemberToken } from '@/server/roster/customer-service';
import { RosterMemberView, type RosterMemberViewProps } from './view';

export const dynamic = 'force-dynamic';

// Never let search engines index individual roster URLs.
export const metadata = { robots: { index: false, follow: false } };

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
      sizeCharts: await Promise.all(
        garment.sizeCharts.map(async (chart) => {
          let url: string | null = null;
          let downloadUrl: string | null = null;

          try {
            if (chart.storageKey) {
              const filename = chart.storageKey.split('/').pop() ?? chart.name;
              [url, downloadUrl] = await Promise.all([
                getSignedUrl(chart.storageKey, 3600),
                getSignedUrl(chart.storageKey, 3600, {
                  contentDisposition: `attachment; filename="${filename}"`,
                }),
              ]);
            }
          } catch {
            // Storage not configured in this environment — leave links empty.
          }

          return {
            name: chart.name,
            storageKey: chart.storageKey,
            url,
            downloadUrl,
          };
        }),
      ),
    })),
  );

  return (
    <RosterMemberView
      memberToken={memberToken}
      roster={{
        orderNumber: roster.order.orderNumber,
        clubName: roster.order.clubName,
        locked: roster.order.locked,
        garments,
        member: {
          ...roster.member,
          submittedAt: roster.member.submittedAt?.toISOString() ?? null,
        },
      }}
    />
  );
}
