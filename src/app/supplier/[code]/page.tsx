import { SupplierPortalHomeView } from './view';

// Never let search engines index supplier portal URLs.
export const metadata = { title: 'Supplier Portal', robots: { index: false, follow: false } };

type Props = { params: Promise<{ code: string }> };

/**
 * The password-gated supplier portal home (David, 2026-08-05). Pure client
 * surface: the view fetches /api/supplier/[code]/pos, and a 401 shows the
 * login card — the server makes no auth decision here, so an unknown code
 * renders exactly like a signed-out known one.
 */
export default async function SupplierPortalHomePage({ params }: Props) {
  const { code } = await params;
  return <SupplierPortalHomeView code={code} />;
}
