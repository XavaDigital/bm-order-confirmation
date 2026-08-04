import type { OrderAssetKind } from '@/db/schema';

/** Shared label/color presentation for `order_assets.kind`, mirroring the src/lib/status.ts convention. */
export const ASSET_KIND_LABEL: Record<OrderAssetKind, string> = {
  design: 'Design',
  font: 'Font',
  other: 'Other',
};

export const ASSET_KIND_COLOR: Record<OrderAssetKind, string> = {
  design: 'geekblue',
  font: 'purple',
  other: 'default',
};
