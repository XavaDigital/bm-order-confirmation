'use client';

/**
 * The order's production summary plus the derived "you need to do something in
 * Production" signals, owned ONCE by the order-detail view so the rail badge,
 * the garments warning, and the Production panel can't disagree — and so a
 * garment/sizing edit can refresh all three without a page reload.
 */
import { useAdminResource } from '@/lib/use-admin-resource';
import type { ProductionSummary } from '@/types/production';

/** A PO in one of these states no longer represents work to reconcile. */
const INERT_PO_STATUSES = new Set(['cancelled']);

export interface ProductionAttention {
  /** Sizing rows not covered by any live purchase order. */
  uncoveredRows: number;
  /** Live POs whose snapshot no longer matches the order. */
  posWithVariance: number;
  /** True when staff must act: raise a PO for new rows, or revise a stale one. */
  needsAttention: boolean;
  /** One-line explanation for the badge tooltip / warning heading. */
  message: string | null;
}

const NONE: ProductionAttention = {
  uncoveredRows: 0,
  posWithVariance: 0,
  needsAttention: false,
  message: null,
};

/**
 * Derive the attention state from a summary. Pure — unit-tested directly.
 *
 * Gated on the order having at least one live PO: before production starts
 * every row is legitimately "uncovered", so warning then would be pure noise.
 * Once a supplier is building something, though, an uncovered row or a drifted
 * snapshot means a new PO (or a revision) is owed.
 */
export function deriveProductionAttention(
  summary: ProductionSummary | null | undefined,
): ProductionAttention {
  // Defensive on shape, not just on null: a malformed payload must not take
  // the whole order-detail view down with it.
  if (!summary || !Array.isArray(summary.purchaseOrders) || !summary.coverage) return NONE;

  const livePos = summary.purchaseOrders.filter((po) => !INERT_PO_STATUSES.has(po.status));
  if (livePos.length === 0) return NONE;

  const uncoveredRows = Math.max(
    (summary.coverage.totalRows ?? 0) - (summary.coverage.coveredRows ?? 0),
    0,
  );
  const posWithVariance = livePos.filter((po) => po.variance?.hasVariance).length;
  const needsAttention = uncoveredRows > 0 || posWithVariance > 0;

  if (!needsAttention) return { uncoveredRows: 0, posWithVariance: 0, needsAttention: false, message: null };

  const parts: string[] = [];
  if (uncoveredRows > 0) {
    parts.push(
      `${uncoveredRows} sizing ${uncoveredRows === 1 ? 'row is' : 'rows are'} not covered by a purchase order`,
    );
  }
  if (posWithVariance > 0) {
    parts.push(
      `${posWithVariance} purchase ${posWithVariance === 1 ? 'order has' : 'orders have'} changed since ${posWithVariance === 1 ? 'it was' : 'they were'} issued`,
    );
  }

  return { uncoveredRows, posWithVariance, needsAttention, message: parts.join(' · ') };
}

export function useProductionSummary(orderId: string) {
  const { data, loading, error, reload } = useAdminResource<ProductionSummary>(
    `/api/admin/orders/${orderId}/purchase-orders`,
    { errorMessage: 'Failed to load production summary', toast: false },
  );

  return {
    summary: data ?? null,
    loading,
    error,
    reload,
    attention: deriveProductionAttention(data),
  };
}
