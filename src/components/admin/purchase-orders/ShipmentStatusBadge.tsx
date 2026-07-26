'use client';

import { Tag } from 'antd';
import { shipmentStatusMeta } from '@/lib/status';

export function ShipmentStatusBadge({ status }: { status: string }) {
  const meta = shipmentStatusMeta(status);
  return <Tag color={meta.tag}>{meta.label}</Tag>;
}
