'use client';

import { useState } from 'react';
import { Table, Input, Select, Button, Space, App, Popconfirm, Typography } from 'antd';
import { PlusOutlined, DeleteOutlined, SaveOutlined } from '@ant-design/icons';
import type { ColumnType } from 'antd/es/table';
import { postJson } from '@/lib/api-fetch';
import { buildSizeSelectOptions } from '@/lib/sizes';
import type { SizeChartSize } from '@/db/schema';

interface SizingRow {
  key: string; // local key for React, not stored in DB
  /** DB row id — present on saved rows; carried through saves so the server
   * updates in place (stable UUIDs for roster attribution + PO snapshots). */
  id?: string;
  size: string;
  playerName: string;
  playerNumber: string;
  notes: string;
}

interface Props {
  orderId: string;
  garmentId: string;
  initialRows: {
    id?: string;
    size?: string | null;
    playerName?: string | null;
    playerNumber?: string | null;
    notes?: string | null;
  }[];
  /** Chart-defined sizes (from the garment's linked size charts) — when
   * non-empty, the Size cell becomes a select incl. "<size> Tall" variants. */
  allowedSizes?: SizeChartSize[];
}

function toLocal(rows: Props['initialRows']): SizingRow[] {
  return rows.map((r, i) => ({
    key: r.id ?? `new-${i}`,
    id: r.id,
    size: r.size ?? '',
    playerName: r.playerName ?? '',
    playerNumber: r.playerNumber ?? '',
    notes: r.notes ?? '',
  }));
}

export function SizingTable({ orderId, garmentId, initialRows, allowedSizes }: Props) {
  const { message } = App.useApp();
  const [rows, setRows] = useState<SizingRow[]>(() => toLocal(initialRows));
  const [saving, setSaving] = useState(false);
  const constrained = allowedSizes !== undefined && allowedSizes.length > 0;
  const sizeOptions = constrained ? buildSizeSelectOptions(allowedSizes) : [];

  function updateCell(key: string, field: keyof SizingRow, value: string) {
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)),
    );
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      { key: `new-${Date.now()}`, size: '', playerName: '', playerNumber: '', notes: '' },
    ]);
  }

  function removeRow(key: string) {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }

  async function save() {
    setSaving(true);
    try {
      const body = rows.map((r, i) => ({
        ...(r.id ? { id: r.id } : {}),
        size: r.size || null,
        playerName: r.playerName || null,
        playerNumber: r.playerNumber || null,
        notes: r.notes || null,
        sortOrder: i,
      }));
      const res = await postJson<{ ok: boolean; rows: Props['initialRows'] }>(
        `/api/admin/orders/${orderId}/garments/${garmentId}/sizing`,
        body,
        'Failed to save',
      );
      // Re-seed from the server response so newly inserted rows pick up their
      // ids — the next save then updates in place instead of reinserting.
      if (Array.isArray(res.rows)) setRows(toLocal(res.rows));
      message.success('Sizing saved');
    } catch {
      message.error('Failed to save sizing');
    } finally {
      setSaving(false);
    }
  }

  const columns: ColumnType<SizingRow>[] = [
    {
      title: 'Size',
      dataIndex: 'size',
      width: constrained ? 140 : 90,
      render(_: unknown, record: SizingRow) {
        if (constrained) {
          return (
            <Select
              size="small"
              value={record.size || undefined}
              placeholder="Size"
              onChange={(v) => updateCell(record.key, 'size', v ?? '')}
              options={sizeOptions}
              variant="borderless"
              style={{ minWidth: 110, width: '100%' }}
              showSearch
              allowClear
              // Escape hatch: free-typing stays possible for one-off sizes
              // (custom value committed on Enter via search text).
              onInputKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const typed = (e.target as HTMLInputElement).value.trim();
                  if (typed) updateCell(record.key, 'size', typed);
                }
              }}
            />
          );
        }
        return (
          <Input size="small" value={record.size} placeholder="S / M / L…"
            onChange={(e) => updateCell(record.key, 'size', e.target.value)}
            variant="borderless" style={{ minWidth: 60 }} />
        );
      },
    },
    {
      title: 'Player Name',
      dataIndex: 'playerName',
      width: 160,
      render(_: unknown, record: SizingRow) {
        return (
          <Input size="small" value={record.playerName} placeholder="Name"
            onChange={(e) => updateCell(record.key, 'playerName', e.target.value)}
            variant="borderless" style={{ minWidth: 60 }} />
        );
      },
    },
    {
      title: '#',
      dataIndex: 'playerNumber',
      width: 70,
      render(_: unknown, record: SizingRow) {
        return (
          <Input size="small" value={record.playerNumber} placeholder="7"
            onChange={(e) => updateCell(record.key, 'playerNumber', e.target.value)}
            variant="borderless" style={{ minWidth: 60 }} />
        );
      },
    },
    {
      title: 'Notes',
      dataIndex: 'notes',
      render(_: unknown, record: SizingRow) {
        return (
          <Input size="small" value={record.notes} placeholder="Optional"
            onChange={(e) => updateCell(record.key, 'notes', e.target.value)}
            variant="borderless" style={{ minWidth: 60 }} />
        );
      },
    },
    {
      title: '',
      key: 'actions',
      width: 40,
      render(_: unknown, record: SizingRow) {
        return (
          <Popconfirm
            title="Remove row?"
            onConfirm={() => removeRow(record.key)}
            okText="Remove"
            okType="danger"
          >
            <Button type="text" size="small" icon={<DeleteOutlined />} danger />
          </Popconfirm>
        );
      },
    },
  ];

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={8}>
      <Table
        dataSource={rows}
        columns={columns}
        rowKey="key"
        size="small"
        pagination={false}
        locale={{ emptyText: <Typography.Text type="secondary">No sizing rows yet</Typography.Text> }}
        style={{ border: '1px solid var(--ant-color-border)', borderRadius: 4 }}
      />
      <Space>
        <Button size="small" icon={<PlusOutlined />} onClick={addRow}>
          Add row
        </Button>
        <Button
          size="small"
          type="primary"
          icon={<SaveOutlined />}
          loading={saving}
          onClick={save}
        >
          Save sizing
        </Button>
      </Space>
    </Space>
  );
}
