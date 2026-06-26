'use client';

import { useState } from 'react';
import { Table, Input, Button, Space, App, Popconfirm, Typography } from 'antd';
import { PlusOutlined, DeleteOutlined, SaveOutlined } from '@ant-design/icons';
import type { ColumnType } from 'antd/es/table';

interface SizingRow {
  key: string; // local key for React, not stored in DB
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
}

function toLocal(rows: Props['initialRows']): SizingRow[] {
  return rows.map((r, i) => ({
    key: r.id ?? `new-${i}`,
    size: r.size ?? '',
    playerName: r.playerName ?? '',
    playerNumber: r.playerNumber ?? '',
    notes: r.notes ?? '',
  }));
}

export function SizingTable({ orderId, garmentId, initialRows }: Props) {
  const { message } = App.useApp();
  const [rows, setRows] = useState<SizingRow[]>(() => toLocal(initialRows));
  const [saving, setSaving] = useState(false);

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
        size: r.size || null,
        playerName: r.playerName || null,
        playerNumber: r.playerNumber || null,
        notes: r.notes || null,
        sortOrder: i,
      }));
      const res = await fetch(
        `/api/admin/orders/${orderId}/garments/${garmentId}/sizing`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) throw new Error('Failed to save');
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
      width: 90,
      render(_: unknown, record: SizingRow) {
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
