'use client';

import { useState, useEffect } from 'react';
import { Select, App, Typography } from 'antd';
import { getJson, patchJson } from '@/lib/api-fetch';

interface SizeChart {
  id: string;
  name: string;
  description: string | null;
}

interface Props {
  orderId: string;
  garmentId: string;
  initialIds: string[];
}

export function SizeChartLinker({ orderId, garmentId, initialIds }: Props) {
  const { message } = App.useApp();
  const [allCharts, setAllCharts] = useState<SizeChart[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>(initialIds);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getJson<SizeChart[]>('/api/admin/size-charts', 'Failed to load size charts')
      .then(setAllCharts)
      .catch(() => message.error('Failed to load size charts'))
      .finally(() => setLoading(false));
  }, []);

  async function handleChange(ids: string[]) {
    setSelectedIds(ids);
    setSaving(true);
    try {
      await patchJson(`/api/admin/orders/${orderId}/garments/${garmentId}`, { sizeChartIds: ids }, 'Save failed');
    } catch {
      message.error('Failed to save size chart links');
    } finally {
      setSaving(false);
    }
  }

  if (!loading && allCharts.length === 0) {
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
      loading={loading || saving}
      value={selectedIds}
      onChange={handleChange}
      options={allCharts.map((c) => ({
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
