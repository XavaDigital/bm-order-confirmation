'use client';

import { Tag } from 'antd';

const STATUS_COLORS: Record<string, string> = {
  draft: 'default',
  sent: 'processing',
  viewed: 'warning',
  confirmed: 'success',
  changes_requested: 'error',
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  sent: 'Sent',
  viewed: 'Viewed',
  confirmed: 'Confirmed',
  changes_requested: 'Changes Requested',
};

export function OrderStatusBadge({ status }: { status: string }) {
  return (
    <Tag color={STATUS_COLORS[status] ?? 'default'}>
      {STATUS_LABELS[status] ?? status}
    </Tag>
  );
}
