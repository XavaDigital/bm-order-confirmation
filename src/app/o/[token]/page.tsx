import { notFound } from 'next/navigation';
import { getOrderForCustomer, recordOrderViewed } from '@/server/orders/customer-service';
import { getSignedUrl } from '@/lib/storage';
import { CustomerOrderView, type CustomerOrderViewProps } from './view';

export const dynamic = 'force-dynamic';

// Never let search engines index customer confirmation URLs.
export const metadata = { robots: { index: false, follow: false } };

type Props = { params: Promise<{ token: string }> };

async function signImageUrls(
  images: { id: string; storageKey: string; caption: string | null; sortOrder: number }[],
): Promise<{ id: string; caption: string | null; url: string }[]> {
  return Promise.all(
    images.map(async (img) => {
      let url = '';
      try {
        url = await getSignedUrl(img.storageKey, 3600);
      } catch {
        // Storage not configured in this environment — leave empty.
      }
      return { id: img.id, caption: img.caption, url };
    }),
  );
}

export default async function CustomerOrderPage({ params }: Props) {
  const { token } = await params;
  const result = await getOrderForCustomer(token);

  // Generic 404 — never reveal whether a token is invalid, expired, or revoked.
  if (!result) notFound();

  const { order, access } = result;

  // Record the view (transitions 'sent' → 'viewed', emits domain event, updates last_viewed_at).
  // Fire-and-forget: a view-recording failure must not block the customer seeing their order.
  recordOrderViewed(order.id, access.id, order.status).catch((err) =>
    console.error('[page.tsx] recordOrderViewed failed', err),
  );

  // Build garment data with signed image URLs and signed size chart URLs
  const garments: CustomerOrderViewProps['order']['garments'] = await Promise.all(
    order.garments.map(async (g) => ({
      id: g.id,
      name: g.name,
      fabrics: Array.isArray(g.fabrics) ? (g.fabrics as string[]) : [],
      notes: g.notes ?? null,
      sizing: g.sizing.map((s) => ({
        size: s.size ?? null,
        playerName: s.playerName ?? null,
        playerNumber: s.playerNumber ?? null,
        notes: s.notes ?? null,
      })),
      images: await signImageUrls(g.images),
      sizeCharts: await Promise.all(
        g.sizeChartLinks
          .filter((l) => l.sizeChart)
          .map(async (l) => {
            let url: string | null = null;
            try {
              if (l.sizeChart!.storageKey) {
                url = await getSignedUrl(l.sizeChart!.storageKey, 3600);
              }
            } catch { /* storage not configured */ }
            return {
              name: l.sizeChart!.name,
              storageKey: l.sizeChart!.storageKey ?? null,
              url,
            };
          }),
      ),
    })),
  );

  const data: CustomerOrderViewProps['order'] = {
    id: order.id,
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    customerEmail: order.customerEmail,
    clubName: order.clubName ?? null,
    status: order.status,
    orderValueAmount: order.orderValueAmount ?? null,
    orderValueCurrency: order.orderValueCurrency ?? 'NZD',
    invoiceUrl: order.invoiceUrl ?? null,
    expectedShipDate: order.expectedShipDate ?? null,
    deadlineDate: order.deadlineDate ?? null,
    generalNotes: order.generalNotes ?? null,
    shippingMode: order.shippingMode,
    shippingAddress: order.shippingAddress ?? null,
    garments,
  };

  return <CustomerOrderView token={token} order={data} />;
}
