'use client';

import { Tag } from 'antd';
import { orderStatusMeta } from '@/lib/status';

export function OrderStatusBadge({ status }: { status: string }) {
  const meta = orderStatusMeta(status);
  return <Tag color={meta.tag}>{meta.label}</Tag>;
}
