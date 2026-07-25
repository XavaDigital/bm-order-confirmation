import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { getOrderForCustomer, recordOrderViewed } from '@/server/orders/customer-service';
import { toGarmentDto } from '@/server/orders/mappers';
import { signChartRefs, signImageRefs } from '@/lib/signed-urls';
import { ACCESS_CODE_COOKIE, isAccessCodeCookieValid } from '@/lib/access-code';
import { AccessCodeGate } from '@/components/customer/AccessCodeGate';
import { CustomerOrderView, type CustomerOrderViewProps } from './view';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

// Never let search engines index customer confirmation URLs.
export const metadata = { robots: { index: false, follow: false } };

type Props = { params: Promise<{ token: string }> };

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
    logger.error('[page.tsx] recordOrderViewed failed', err),
  );

  // Build garment data with signed image URLs and signed size chart URLs
  const garments: CustomerOrderViewProps['order']['garments'] = await Promise.all(
    order.garments.map(async (g) => ({
      id: g.id,
      ...toGarmentDto(g, { rosterFlags: true }),
      images: (await signImageRefs(g.images)).map((img) => ({
        id: img.id,
        caption: img.caption,
        url: img.url,
      })),
      sizeCharts: await signChartRefs(
        g.sizeChartLinks.filter((l) => l.sizeChart).map((l) => l.sizeChart!),
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
    colorSampleRequested: order.colorSampleRequestedAt !== null,
    rosterSummary: order.rosterSummary,
    garments,
  };

  return <CustomerOrderView token={token} order={data} />;
}
