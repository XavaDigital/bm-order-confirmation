'use client';

import { useState } from 'react';
import { Table, Input, Button, Space, App, Popconfirm, Typography, Tooltip } from 'antd';
import { PlusOutlined, DeleteOutlined, SaveOutlined, ImportOutlined } from '@ant-design/icons';
import type { ColumnType } from 'antd/es/table';
import { postJson } from '@/lib/api-fetch';

interface NameListRow {
  key: string; // local key for React, not stored in DB
  /** DB row id — present on saved rows; carried through saves so the server
   * updates in place (stable UUIDs). */
  id?: string;
  name: string;
  playerNumber: string;
}

interface Props {
  orderId: string;
  garmentId: string;
  initialEntries: { id?: string; name?: string | null; playerNumber?: string | null }[];
  /** Called after a successful save or import. */
  onSaved?: () => void;
}

function toLocal(entries: Props['initialEntries']): NameListRow[] {
  return entries.map((e, i) => ({
    key: e.id ?? `new-${i}`,
    id: e.id,
    name: e.name ?? '',
    playerNumber: e.playerNumber ?? '',
  }));
}

/**
 * "Got Your Back" style name list — the print content for a shared design
 * (GOT_YOUR_BACK_PLAN.md). Deliberately simpler than SizingTable: no size, no
 * quantity (these entries are never manufacture units), no custom columns.
 */
export function NameListTable({ orderId, garmentId, initialEntries, onSaved }: Props) {
  const { message } = App.useApp();
  const [rows, setRows] = useState<NameListRow[]>(() => toLocal(initialEntries));
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);

  function updateCell(key: string, field: 'name' | 'playerNumber', value: string) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, { key: `new-${Date.now()}`, name: '', playerNumber: '' }]);
  }

  function removeRow(key: string) {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }

  async function save() {
    setSaving(true);
    try {
      const body = rows
        .filter((r) => r.name.trim())
        .map((r, i) => ({
          ...(r.id ? { id: r.id } : {}),
          name: r.name.trim(),
          playerNumber: r.playerNumber.trim() || undefined,
          sortOrder: i,
        }));
      const res = await postJson<{ ok: boolean; entries: Props['initialEntries'] }>(
        `/api/admin/orders/${orderId}/garments/${garmentId}/name-list`,
        body,
        'Failed to save',
      );
      // Re-seed from the server response so newly inserted rows pick up their
      // ids — the next save then updates in place instead of reinserting.
      if (Array.isArray(res.entries)) setRows(toLocal(res.entries));
      message.success('Name list saved');
      onSaved?.();
    } catch {
      message.error('Failed to save name list');
    } finally {
      setSaving(false);
    }
  }

  async function importFromRoster() {
    setImporting(true);
    try {
      const res = await postJson<{ ok: boolean; imported: number; entries: Props['initialEntries'] }>(
        `/api/admin/orders/${orderId}/garments/${garmentId}/name-list/import-roster`,
        undefined,
        'Failed to import from roster',
      );
      if (Array.isArray(res.entries)) setRows(toLocal(res.entries));
      if (res.imported > 0) {
        message.success(`Imported ${res.imported} name${res.imported > 1 ? 's' : ''} from the team roster`);
        onSaved?.();
      } else {
        message.info('No new roster names to import');
      }
    } catch {
      message.error('Failed to import from roster');
    } finally {
      setImporting(false);
    }
  }

  const columns: ColumnType<NameListRow>[] = [
    {
      title: 'Name',
      dataIndex: 'name',
      render(_: unknown, record: NameListRow) {
        return (
          <Input
            size="small"
            value={record.name}
            placeholder="Name"
            onChange={(e) => updateCell(record.key, 'name', e.target.value)}
            variant="borderless"
            style={{ minWidth: 60 }}
          />
        );
      },
    },
    {
      title: '#',
      dataIndex: 'playerNumber',
      width: 90,
      render(_: unknown, record: NameListRow) {
        return (
          <Input
            size="small"
            value={record.playerNumber}
            placeholder="Optional"
            onChange={(e) => updateCell(record.key, 'playerNumber', e.target.value)}
            variant="borderless"
            style={{ minWidth: 60 }}
          />
        );
      },
    },
    {
      title: '',
      key: 'actions',
      width: 40,
      render(_: unknown, record: NameListRow) {
        return (
          <Popconfirm title="Remove name?" onConfirm={() => removeRow(record.key)} okText="Remove" okType="danger">
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
        locale={{ emptyText: <Typography.Text type="secondary">No names yet</Typography.Text> }}
        style={{ border: '1px solid var(--ant-color-border)', borderRadius: 4 }}
        footer={() => (
          <Button type="dashed" block icon={<PlusOutlined />} onClick={addRow} style={{ height: 36 }}>
            Add name
          </Button>
        )}
      />
      <Space wrap>
        <Tooltip title="Copy in any team roster names not already on this list">
          <Button size="small" icon={<ImportOutlined />} loading={importing} onClick={importFromRoster}>
            Import from roster
          </Button>
        </Tooltip>
        <Button size="small" type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>
          Save name list
        </Button>
      </Space>
    </Space>
  );
}
