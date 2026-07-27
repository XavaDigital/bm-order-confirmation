'use client';

import { useState } from 'react';
import { Table, Input, Select, Button, Space, App, Popconfirm, Typography, Tooltip } from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  SaveOutlined,
  EditOutlined,
  TableOutlined,
} from '@ant-design/icons';
import type { ColumnType } from 'antd/es/table';
import { postJson } from '@/lib/api-fetch';
import { buildSizeSelectOptions } from '@/lib/sizes';
import type { GarmentTypeOption, SizeChartSize } from '@/db/schema';
import { SizingColumnModal } from './SizingColumnModal';

interface SizingRow {
  key: string; // local key for React, not stored in DB
  /** DB row id — present on saved rows; carried through saves so the server
   * updates in place (stable UUIDs for roster attribution + PO snapshots). */
  id?: string;
  size: string;
  playerName: string;
  playerNumber: string;
  notes: string;
  /** Values for the garment's custom columns, keyed by column label. */
  customValues: Record<string, string>;
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
    customValues?: Record<string, string> | null;
  }[];
  /** Chart-defined sizes (from the garment's linked size charts) — when
   * non-empty, the Size cell becomes a select incl. "<size> Tall" variants. */
  allowedSizes?: SizeChartSize[];
  /** Called after a successful save — sizing rows drive purchase-order coverage. */
  onSaved?: () => void;
  /** The garment's custom column definitions (Colour, Sponsor…). */
  sizingColumns?: GarmentTypeOption[];
  /** Persist a changed column set on the garment. */
  onColumnsChange?: (columns: GarmentTypeOption[]) => Promise<void> | void;
}

function toLocal(rows: Props['initialRows']): SizingRow[] {
  return rows.map((r, i) => ({
    key: r.id ?? `new-${i}`,
    id: r.id,
    size: r.size ?? '',
    playerName: r.playerName ?? '',
    playerNumber: r.playerNumber ?? '',
    notes: r.notes ?? '',
    customValues: { ...(r.customValues ?? {}) },
  }));
}

export function SizingTable({
  orderId,
  garmentId,
  initialRows,
  allowedSizes,
  onSaved,
  sizingColumns = [],
  onColumnsChange,
}: Props) {
  const { message } = App.useApp();
  const [rows, setRows] = useState<SizingRow[]>(() => toLocal(initialRows));
  const [saving, setSaving] = useState(false);
  const [columnModalOpen, setColumnModalOpen] = useState(false);
  const [editingColumn, setEditingColumn] = useState<GarmentTypeOption | null>(null);
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
      {
        key: `new-${Date.now()}`,
        size: '',
        playerName: '',
        playerNumber: '',
        notes: '',
        customValues: {},
      },
    ]);
  }

  function updateCustomValue(key: string, label: string, value: string) {
    setRows((prev) =>
      prev.map((r) =>
        r.key === key ? { ...r, customValues: { ...r.customValues, [label]: value } } : r,
      ),
    );
  }

  async function saveColumns(next: GarmentTypeOption[]) {
    try {
      await onColumnsChange?.(next);
    } catch {
      message.error('Failed to save the column');
    }
  }

  function removeColumn(label: string) {
    void saveColumns(sizingColumns.filter((c) => c.label !== label));
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
        customValues: r.customValues,
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
      onSaved?.();
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
    // User-defined columns — same select-vs-text branch as the Size cell, with
    // a header affordance for editing/removing the column itself.
    ...sizingColumns.map((column): ColumnType<SizingRow> => ({
      key: `custom:${column.label}`,
      width: column.type === 'select' ? 140 : 150,
      title: (
        <Space size={4}>
          <span>{column.label}</span>
          {onColumnsChange && (
            <>
              <Tooltip title="Edit column">
                <Button
                  type="text"
                  size="small"
                  aria-label={`Edit column ${column.label}`}
                  icon={<EditOutlined />}
                  onClick={() => {
                    setEditingColumn(column);
                    setColumnModalOpen(true);
                  }}
                />
              </Tooltip>
              <Popconfirm
                title={`Remove the “${column.label}” column?`}
                description="Values already entered in this column are kept but stop showing."
                onConfirm={() => removeColumn(column.label)}
                okText="Remove"
                okType="danger"
              >
                <Button
                  type="text"
                  size="small"
                  danger
                  aria-label={`Remove column ${column.label}`}
                  icon={<DeleteOutlined />}
                />
              </Popconfirm>
            </>
          )}
        </Space>
      ),
      render(_: unknown, record: SizingRow) {
        const value = record.customValues[column.label] ?? '';
        if (column.type === 'select') {
          return (
            <Select
              size="small"
              value={value || undefined}
              placeholder={column.label}
              onChange={(v) => updateCustomValue(record.key, column.label, v ?? '')}
              options={column.options.map((o) => ({ value: o, label: o }))}
              variant="borderless"
              style={{ minWidth: 110, width: '100%' }}
              showSearch
              allowClear
            />
          );
        }
        return (
          <Input
            size="small"
            value={value}
            placeholder={column.label}
            onChange={(e) => updateCustomValue(record.key, column.label, e.target.value)}
            variant="borderless"
            style={{ minWidth: 60 }}
          />
        );
      },
    })),
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
      <Space wrap>
        <Button size="small" icon={<PlusOutlined />} onClick={addRow}>
          Add row
        </Button>
        {onColumnsChange && (
          <Button
            size="small"
            icon={<TableOutlined />}
            onClick={() => {
              setEditingColumn(null);
              setColumnModalOpen(true);
            }}
          >
            Add column
          </Button>
        )}
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

      {onColumnsChange && (
        <SizingColumnModal
          open={columnModalOpen}
          editing={editingColumn}
          existingLabels={sizingColumns.map((c) => c.label)}
          onClose={() => setColumnModalOpen(false)}
          onSave={(column) => {
            const next = editingColumn
              ? sizingColumns.map((c) => (c.label === editingColumn.label ? column : c))
              : [...sizingColumns, column];
            void saveColumns(next);
          }}
        />
      )}
    </Space>
  );
}
