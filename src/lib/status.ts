/**
 * The ONE place order-status presentation lives: label, antd Tag color, and
 * raw hex (for charts/dots). DashboardView and OrderStatusBadge previously
 * kept separate maps that disagreed (sent/viewed colors were swapped) — add
 * new statuses here only.
 */
export type OrderStatus =
  | 'draft'
  | 'sent'
  | 'viewed'
  | 'confirmed'
  | 'changes_requested'
  | 'cancelled';

export interface StatusMeta {
  label: string;
  /** antd <Tag color> preset. */
  tag: string;
  /** Raw color for chart dots/legends — matches the Tag preset's hue. */
  hex: string;
}

export const ORDER_STATUS: Record<OrderStatus, StatusMeta> = {
  draft: { label: 'Draft', tag: 'default', hex: '#8c8c8c' },
  sent: { label: 'Sent', tag: 'processing', hex: '#1677ff' },
  viewed: { label: 'Viewed', tag: 'warning', hex: '#faad14' },
  confirmed: { label: 'Confirmed', tag: 'success', hex: '#52c41a' },
  changes_requested: { label: 'Changes Requested', tag: 'error', hex: '#ff4d4f' },
  cancelled: { label: 'Cancelled', tag: 'default', hex: '#595959' },
};

/** Meta for any status string, falling back gracefully for unknown values. */
export function orderStatusMeta(status: string): StatusMeta {
  return (
    ORDER_STATUS[status as OrderStatus] ?? { label: status, tag: 'default', hex: '#8c8c8c' }
  );
}

// --- purchase orders ---------------------------------------------------------

export type PoStatus =
  | 'draft'
  | 'sent'
  | 'confirmed'
  | 'pre_production'
  | 'in_production'
  | 'in_transit'
  | 'received'
  | 'completed'
  | 'remake'
  | 'cancelled';

/** Colors follow the legacy bm-quote map — what production staff recognize. */
export const PO_STATUS: Record<PoStatus, StatusMeta> = {
  draft: { label: 'Draft', tag: 'default', hex: '#8c8c8c' },
  sent: { label: 'Sent', tag: 'blue', hex: '#1677ff' },
  confirmed: { label: 'Confirmed', tag: 'cyan', hex: '#13c2c2' },
  pre_production: { label: 'Pre-production', tag: 'purple', hex: '#722ed1' },
  in_production: { label: 'In production', tag: 'geekblue', hex: '#2f54eb' },
  in_transit: { label: 'In transit', tag: 'orange', hex: '#fa8c16' },
  received: { label: 'Received', tag: 'green', hex: '#52c41a' },
  completed: { label: 'Completed', tag: 'success', hex: '#52c41a' },
  remake: { label: 'Remake', tag: 'red', hex: '#ff4d4f' },
  cancelled: { label: 'Cancelled', tag: 'default', hex: '#595959' },
};

export function poStatusMeta(status: string): StatusMeta {
  return PO_STATUS[status as PoStatus] ?? { label: status, tag: 'default', hex: '#8c8c8c' };
}

// --- shipments ---------------------------------------------------------------

export type ShipmentStatus =
  | 'pending'
  | 'in_transit'
  | 'delivered'
  | 'delayed'
  | 'exception'
  | 'cancelled';

export const SHIPMENT_STATUS: Record<ShipmentStatus, StatusMeta> = {
  pending: { label: 'Pending', tag: 'default', hex: '#8c8c8c' },
  in_transit: { label: 'In transit', tag: 'blue', hex: '#1677ff' },
  delivered: { label: 'Delivered', tag: 'green', hex: '#52c41a' },
  delayed: { label: 'Delayed', tag: 'orange', hex: '#fa8c16' },
  exception: { label: 'Exception', tag: 'red', hex: '#ff4d4f' },
  cancelled: { label: 'Cancelled', tag: 'default', hex: '#595959' },
};

export function shipmentStatusMeta(status: string): StatusMeta {
  return (
    SHIPMENT_STATUS[status as ShipmentStatus] ?? { label: status, tag: 'default', hex: '#8c8c8c' }
  );
}
