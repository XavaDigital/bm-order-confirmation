import { ShipmentsView } from './ShipmentsView';

// All staff manage shipments (routes are auth: 'staff') — no role prop needed,
// unlike the admin-only reference-data pages.
export default function ShipmentsPage() {
  return <ShipmentsView />;
}
