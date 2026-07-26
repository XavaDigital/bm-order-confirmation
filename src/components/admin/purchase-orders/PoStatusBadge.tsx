'use client';

import { Tag } from 'antd';
import { poStatusMeta } from '@/lib/status';

export function PoStatusBadge({ status }: { status: string }) {
  const meta = poStatusMeta(status);
  return <Tag color={meta.tag}>{meta.label}</Tag>;
}
