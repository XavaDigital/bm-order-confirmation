'use client';

import { useState, useEffect } from 'react';
import { Select, App, Typography } from 'antd';

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
    fetch('/api/admin/size-charts')
      .then((r) => r.json())
      .then((data: SizeChart[]) => setAllCharts(data))
      .catch(() => message.error('Failed to load size charts'))
      .finally(() => setLoading(false));
  }, []);

  async function handleChange(ids: string[]) {
    setSelectedIds(ids);
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/garments/${garmentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sizeChartIds: ids }),
      });
      if (!res.ok) throw new Error('Save failed');
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
