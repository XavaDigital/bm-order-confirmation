/**
 * Shared DTO shapes for the customer surface (`/o/**`) — the data contracts
 * delivered by the page.tsx server components to the client views. Extracted
 * so the order-confirmation, shared-roster, and per-member views (and the
 * shared components under src/components/customer/) agree on one definition.
 */
import type { SizeChartSize } from '@/db/schema';
import type { GalleryImage } from '@/components/customer/MockupGallery';
import type { SizingRow } from '@/components/customer/SizingTableReadOnly';
import type { GarmentTypeOption } from '@/db/schema';

/** A reference size chart attached to a garment, with short-lived signed URLs. */
export interface SizeChartLink {
  name: string;
  storageKey: string | null;
  url: string | null;
  downloadUrl: string | null;
}

/** Garment as shown on the order-confirmation page (`/o/[token]`). */
export interface OrderGarment {
  id: string;
  name: string;
  fabrics: string[];
  notes: string | null;
  garmentTypeName?: string | null;
  selectedOptions?: Record<string, string> | null;
  selectedFabrics?: Record<string, string> | null;
  sizingColumns?: GarmentTypeOption[];
  sizing: SizingRow[];
  images: GalleryImage[];
  sizeCharts: SizeChartLink[];
}

/** A name printed on a "Got Your Back" style garment's shared design. */
export interface RosterNameListEntry {
  id: string;
  name: string;
  playerNumber: string | null;
}

/** Garment as shown on the roster pages (shared link + per-member link). */
export interface RosterGarment {
  id: string;
  name: string;
  notes: string | null;
  /** Chart-defined sizes — when non-empty the size input becomes a dropdown. */
  sizes: SizeChartSize[];
  sizeCharts: SizeChartLink[];
  /**
   * "Got Your Back" style (GOT_YOUR_BACK_PLAN.md) — many names on one shared
   * design. Manager-edited on the shared roster link only; excluded from the
   * per-member "Enter Your Sizes" flow entirely (no size applies). Optional:
   * always populated by the server, but most garments (and every existing
   * test fixture) simply don't carry this style.
   */
  nameListEnabled?: boolean;
  nameListRows?: number | null;
  nameListEntries?: RosterNameListEntry[];
}

/** Roster member row as delivered to (and returned to) the roster views. */
export interface RosterMemberDto {
  id: string;
  name: string;
  playerNumber: string | null;
  submittedAt: string | null;
  sizes: { garmentId: string; size: string | null }[];
}
