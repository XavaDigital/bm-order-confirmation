import { notFound } from 'next/navigation';
import { getOrderAdmin } from '@/server/orders/service';
import { getSignedUrl } from '@/lib/storage';
import { getChangesRequestedComment, getChangesRequestedCount } from '@/server/events/outbox';
import { OrderDetailView, type AdminOrderData } from './OrderDetailView';

type Props = { params: Promise<{ id: string }> };

/** Enrich each garment's images with 4-hour signed URLs for the admin preview. */
async function withSignedUrls(
  garments: NonNullable<Awaited<ReturnType<typeof getOrderAdmin>>>['garments'],
) {
  return Promise.all(
    garments.map(async (g) => ({
      ...g,
      fabrics: Array.isArray(g.fabrics) ? (g.fabrics as string[]) : [],
      images: await Promise.all(
        g.images.map(async (img) => {
          let url = '';
          try {
            url = await getSignedUrl(img.storageKey, 4 * 3600);
          } catch {
            // Storage not configured — leave URL empty; image won't render but won't crash.
          }
          return { ...img, url };
        }),
      ),
    })),
  );
}

export default async function OrderDetailPage({ params }: Props) {
  const { id } = await params;
  const order = await getOrderAdmin(id);

  if (!order) notFound();

  const [garments, changesRequestedComment, changesRequestedCount] = await Promise.all([
    withSignedUrls(order.garments),
    order.status === 'changes_requested' ? getChangesRequestedComment(id) : Promise.resolve(null),
    order.status === 'changes_requested' ? getChangesRequestedCount(id) : Promise.resolve(0),
  ]);

  const data: AdminOrderData = {
    id: order.id,
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    customerEmail: order.customerEmail,
    customerContact: order.customerContact ?? null,
    clubName: order.clubName ?? null,
    orderValueAmount: order.orderValueAmount ?? null,
    orderValueCurrency: order.orderValueCurrency ?? null,
    invoiceUrl: order.invoiceUrl ?? null,
    expectedShipDate: order.expectedShipDate ?? null,
    deadlineDate: order.deadlineDate ?? null,
    generalNotes: order.generalNotes ?? null,
    internalNotes: order.internalNotes ?? null,
    shippingMode: order.shippingMode,
    status: order.status,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    confirmedAt: order.confirmedAt ? order.confirmedAt.toISOString() : null,
    changesRequestedComment,
    changesRequestedCount,
    garments: garments.map((g) => ({
      id: g.id,
      name: g.name,
      fabrics: g.fabrics,
      notes: g.notes ?? null,
      sortOrder: g.sortOrder,
      sizing: g.sizing.map((s) => ({
        id: s.id,
        size: s.size ?? null,
        playerName: s.playerName ?? null,
        playerNumber: s.playerNumber ?? null,
        notes: s.notes ?? null,
        sortOrder: s.sortOrder,
      })),
      images: g.images.map((img) => ({
        id: img.id,
        storageKey: img.storageKey,
        caption: img.caption ?? null,
        sortOrder: img.sortOrder,
        url: img.url,
      })),
      sizeChartIds: g.sizeChartLinks.map((l) => l.sizeChartId),
    })),
    currentAccess: order.currentAccess
      ? {
          id: order.currentAccess.id,
          createdAt: order.currentAccess.createdAt.toISOString(),
          revokedAt: order.currentAccess.revokedAt
            ? order.currentAccess.revokedAt.toISOString()
            : null,
          hasAccessCode: order.currentAccess.accessCodeHash !== null,
        }
      : null,
  };

  return <OrderDetailView order={data} />;
}
