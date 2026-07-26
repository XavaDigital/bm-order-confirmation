/**
 * Production DTOs as served by GET /api/admin/orders/[id]/purchase-orders
 * (`getOrderProductionSummary`). Shared because the order-detail view derives
 * its "Production needs attention" indicators from the same payload the
 * Production panel renders.
 */

export interface ProductionSummaryGarment {
  id: string;
  name: string;
  sizingRowCount: number;
}

export interface PoVarianceCounts {
  added: number;
  modified: number;
  removed: number;
}

export interface ProductionPoSummary {
  id: string;
  poNumber: string;
  status: string;
  currentRevisionNumber: number;
  deadlineDate: string | null;
  expectedShipDate: string | null;
  actualShipDate: string | null;
  sentAt: string | null;
  receivedAt: string | null;
  supplier: { id: string; name: string };
  latestRevision: {
    revisionNumber: number;
    reason: string | null;
    createdAt: string;
  };
  variance: { hasVariance: boolean };
  varianceCounts: PoVarianceCounts;
}

export interface ProductionSummary {
  orderId: string;
  orderNumber: string;
  garments: ProductionSummaryGarment[];
  purchaseOrders: ProductionPoSummary[];
  coverage: {
    totalRows: number;
    coveredRows: number;
    percentage: number;
    rowToPos: Record<string, Array<{ poId: string; poNumber: string }>>;
    uncoveredByGarment: Record<string, number>;
  };
}
