import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { getOrderForCustomer, recordOrderViewed } from '@/server/orders/customer-service';
import { getSignedUrl } from '@/lib/storage';
import { ACCESS_CODE_COOKIE, isAccessCodeCookieValid } from '@/lib/access-code';
import { AccessCodeGate } from '@/components/customer/AccessCodeGate';
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

  // Optional per-order access code: until the signed verification cookie is
  // present, show only the code prompt — no order details, no view recording.
  if (access.accessCodeHash) {
    const cookieStore = await cookies();
    const codeCookie = cookieStore.get(ACCESS_CODE_COOKIE)?.value ?? null;
    if (!isAccessCodeCookieValid(access, codeCookie)) {
      return <AccessCodeGate token={token} />;
    }
  }

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
            let downloadUrl: string | null = null;
            const storageKey = l.sizeChart!.storageKey ?? null;
            try {
              if (storageKey) {
                const filename = storageKey.split('/').pop() ?? l.sizeChart!.name;
                [url, downloadUrl] = await Promise.all([
                  getSignedUrl(storageKey, 3600),
                  getSignedUrl(storageKey, 3600, {
                    contentDisposition: `attachment; filename="${filename}"`,
                  }),
                ]);
              }
            } catch { /* storage not configured */ }
            return {
              name: l.sizeChart!.name,
              storageKey,
              url,
              downloadUrl,
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
