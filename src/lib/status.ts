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
