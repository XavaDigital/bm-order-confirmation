import { notFound } from 'next/navigation';
import { resolveSupplierPortalView } from '@/server/supplier-portal/service';
import { SupplierPortalView, type SupplierPortalViewProps } from './view';

export const dynamic = 'force-dynamic';

// Never let search engines index supplier portal URLs.
export const metadata = { robots: { index: false, follow: false } };

type Props = { params: Promise<{ token: string }> };

export default async function SupplierPortalPage({ params }: Props) {
  const { token } = await params;

  let view;
  try {
    view = await resolveSupplierPortalView(token);
  } catch {
    // Generic 404 — never reveal whether a token is invalid, expired, or
    // revoked (same information-hiding the customer surface already does).
    notFound();
  }

  const data: SupplierPortalViewProps['view'] = {
    ...view,
    comments: view.comments.map((c) => ({
      id: c.id,
      body: c.body,
      authorKind: c.authorKind,
      authorLabel: c.authorLabel,
      createdAt: c.createdAt.toISOString(),
    })),
  };

  return <SupplierPortalView token={token} view={data} />;
}
