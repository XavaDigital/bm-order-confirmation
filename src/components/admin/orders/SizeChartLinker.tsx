'use client';

import { useState } from 'react';
import { Select, App, Typography } from 'antd';
import { patchJson } from '@/lib/api-fetch';

interface SizeChartOption {
  id: string;
  name: string;
  description: string | null;
}

interface Props {
  orderId: string;
  garmentId: string;
  /** Currently linked chart ids (parent-owned state). */
  value: string[];
  /** The chart library — supplied by the parent (single fetch for all garments). */
  charts: SizeChartOption[];
  /** Called after a successful save so the parent can keep garment state fresh. */
  onSaved: (ids: string[]) => void;
}

export function SizeChartLinker({ orderId, garmentId, value, charts, onSaved }: Props) {
  const { message } = App.useApp();
  const [saving, setSaving] = useState(false);
  // Local echo so the Select feels instant; parent state wins after save/revert.
  const [pendingIds, setPendingIds] = useState<string[] | null>(null);

  async function handleChange(ids: string[]) {
    setPendingIds(ids);
    setSaving(true);
    try {
      await patchJson(`/api/admin/orders/${orderId}/garments/${garmentId}`, { sizeChartIds: ids }, 'Save failed');
      onSaved(ids);
    } catch {
      message.error('Failed to save size chart links');
    } finally {
      setPendingIds(null);
      setSaving(false);
    }
  }

  if (charts.length === 0) {
    return (
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        No size charts in library yet.{' '}
        <a href="/admin/size-charts" target="_blank" rel="noopener noreferrer">
          Add charts →
        </a>
      </Typography.Text>
    );
  }

  return (
    <Select
      mode="multiple"
      loading={saving}
      value={pendingIds ?? value}
      onChange={handleChange}
      options={charts.map((c) => ({
        value: c.id,
        label: c.name,
        title: c.description ?? undefined,
      }))}
      placeholder="Link reference size charts…"
      style={{ width: '100%' }}
      maxTagCount="responsive"
    />
  );
}
