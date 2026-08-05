import { notFound } from 'next/navigation';
import { getSession } from '@/lib/session';
import { getOrderAdmin } from '@/server/orders/service';
import { signImageRefs } from '@/lib/signed-urls';
import { buildConfirmationUrl } from '@/lib/tokens';
import { getChangesRequestedComment, getChangesRequestedCount } from '@/server/events/outbox';
import { OrderDetailView, type AdminOrderData } from './OrderDetailView';

type Props = { params: Promise<{ id: string }> };

// Same key order the address-label route prints — "has an address" here must
// agree with what /api/admin/orders/[id]/address-label 409s on.
const ADDRESS_KEYS = ['line1', 'line2', 'city', 'region', 'postcode', 'country'] as const;

function hasPrintableAddress(shippingAddress: Record<string, unknown> | null): boolean {
  const address = shippingAddress ?? {};
  return ADDRESS_KEYS.some((k) => {
    const v = address[k];
    return typeof v === 'string' && v.trim() !== '';
  });
}

/** Tab title: "OrderFlow - OC-10023 · Winter hoodies" (root layout template). */
export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const order = await getOrderAdmin(id);
  if (!order) return { title: 'Order' };
  return { title: order.name ? `${order.orderNumber} · ${order.name}` : order.orderNumber };
}

/** Enrich each garment's images with 4-hour signed URLs for the admin preview. */
async function withSignedUrls(
  garments: NonNullable<Awaited<ReturnType<typeof getOrderAdmin>>>['garments'],
) {
  return Promise.all(
    garments.map(async (g) => ({
      ...g,
      fabrics: Array.isArray(g.fabrics) ? (g.fabrics as string[]) : [],
      images: await signImageRefs(g.images, 4 * 3600),
    })),
  );
}

export default async function OrderDetailPage({ params }: Props) {
  const { id } = await params;
  const [order, session] = await Promise.all([getOrderAdmin(id), getSession()]);

  if (!order) notFound();

  const [garments, changesRequestedComment, changesRequestedCount] = await Promise.all([
    withSignedUrls(order.garments),
    order.status === 'changes_requested' ? getChangesRequestedComment(id) : Promise.resolve(null),
    order.status === 'changes_requested' ? getChangesRequestedCount(id) : Promise.resolve(0),
  ]);

  const data: AdminOrderData = {
    id: order.id,
    orderNumber: order.orderNumber,
    name: order.name ?? null,
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
    // The address itself stays server-side; the view only needs to know
    // whether the label button has anything to print (disabled otherwise).
    hasShippingAddress: hasPrintableAddress(order.shippingAddress ?? null),
    status: order.status,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    confirmedAt: order.confirmedAt ? order.confirmedAt.toISOString() : null,
    colorSampleRequestedAt: order.colorSampleRequestedAt
      ? order.colorSampleRequestedAt.toISOString()
      : null,
    changesRequestedComment,
    changesRequestedCount,
    hubCustomerId: order.hubCustomerId ?? null,
    hubCustomerName: order.hubCustomerName ?? null,
    hubContactId: order.hubContactId ?? null,
    hubContactName: order.hubContactName ?? null,
    designProjectRef: order.designProjectRef ?? null,
    sourceOrder: order.sourceOrder
      ? { id: order.sourceOrder.id, orderNumber: order.sourceOrder.orderNumber }
      : null,
    reprintReason: order.reprintReason ?? null,
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
        customValues: s.customValues ?? null,
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
      garmentTypeId: g.garmentTypeId ?? null,
      selectedOptions: g.selectedOptions ?? null,
      selectedFabrics: g.selectedFabrics ?? null,
      sizingColumns: g.sizingColumns ?? [],
    })),
    currentAccess: order.currentAccess
      ? {
          id: order.currentAccess.id,
          createdAt: order.currentAccess.createdAt.toISOString(),
          revokedAt: order.currentAccess.revokedAt
            ? order.currentAccess.revokedAt.toISOString()
            : null,
          hasAccessCode: order.currentAccess.accessCodeHash !== null,
          // Rows predating the readable column can't reconstruct their URL.
          url: order.currentAccess.tokenPlain
            ? buildConfirmationUrl(order.currentAccess.tokenPlain)
            : null,
        }
      : null,
  };

  // The note thread needs to know who is reading it: authors get edit/delete on
  // their own notes, and admins get delete on anyone's.
  return (
    <OrderDetailView
      order={data}
      currentUserId={session.userId ?? ''}
      isAdmin={session.role === 'admin'}
    />
  );
}
