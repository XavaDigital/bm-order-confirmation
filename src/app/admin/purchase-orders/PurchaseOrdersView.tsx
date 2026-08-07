'use client';

/**
 * Purchase-orders list page (PO_PLAN). Param-driven fetch against
 * GET /api/admin/purchase-orders (status/supplier/search filters), following
 * OrdersView's pattern. Rows link to the PO detail and the parent order.
 */
import { useState, useEffect, useCallback } from 'react';
import { Table, Checkbox, Input, Segmented, Select, Space, Tag, Tooltip, Typography, App } from 'antd';
import {
  SearchOutlined,
  AppstoreOutlined,
  HourglassOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import Link from 'next/link';
import type { ColumnType } from 'antd/es/table';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { WorkflowBoard } from '@/components/admin/workflow/WorkflowBoard';
import { PoStatusBadge } from '@/components/admin/purchase-orders/PoStatusBadge';
import { poDisplayTitle } from '@/lib/po-title';
import { PO_STATUS } from '@/lib/status';
import { formatDate } from '@/lib/format';
import { getJson } from '@/lib/api-fetch';
import { useAdminResource } from '@/lib/use-admin-resource';

const { Text } = Typography;

interface PoRow {
  id: string;
  poNumber: string;
  /** Human-readable customer part of the display title (David, 2026-08-06). */
  customerRef: string | null;
  status: string;
  currentRevisionNumber: number;
  deadlineDate: string | null;
  expectedShipDate: string | null;
  actualShipDate: string | null;
  sentAt: string | null;
  createdAt: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  supplierId: string;
  supplierName: string;
  /**
   * The awaiting-approval FLAG (David, 2026-08-06): set = the factory finished
   * a phase and it is waiting on US. Not a status — a PO carries it while
   * sitting in whatever status it was already in.
   */
  awaitingApprovalAt?: string | null;
  awaitingApprovalBy?: string | null;
}

interface SupplierOption {
  id: string;
  name: string;
}

const STATUS_OPTIONS = Object.entries(PO_STATUS).map(([value, meta]) => ({
  value,
  label: meta.label,
}));

type ViewMode = 'board' | 'table';

interface Props {
  /** Which view to open on. Overridable so tests can target one directly. */
  initialView?: ViewMode;
}

export function PurchaseOrdersView({ initialView = 'board' }: Props = {}) {
  const { message } = App.useApp();
  /**
   * The board is the landing view. This is the board that earns its keep —
   * unlike orders, a purchase order moves because staff move it.
   */
  const [view, setView] = useState<ViewMode>(initialView);
  const [rows, setRows] = useState<PoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [supplierId, setSupplierId] = useState<string | undefined>(undefined);
  /**
   * "Show only what is waiting on us" (David, 2026-08-06) — the queue he works
   * from. Filtered CLIENT-side: the flag cuts across every status, so it is not
   * a status filter, and the list endpoint already returns the whole set.
   */
  const [awaitingOnly, setAwaitingOnly] = useState(false);

  const { data: suppliers } = useAdminResource<SupplierOption[]>('/api/admin/suppliers', {
    errorMessage: 'Failed to load suppliers',
    toast: false,
  });

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const fetchPos = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (supplierId) params.set('supplierId', supplierId);
      if (debouncedSearch) params.set('search', debouncedSearch);
      const qs = params.toString();
      const data = await getJson<PoRow[]>(
        `/api/admin/purchase-orders${qs ? `?${qs}` : ''}`,
        'Failed to load purchase orders',
      );
      setRows(data);
    } catch {
      message.error('Failed to load purchase orders');
    } finally {
      setLoading(false);
    }
  }, [status, supplierId, debouncedSearch, message]);

  // Only the table needs this data — the board loads its own columns.
  useEffect(() => {
    if (view !== 'table') return;
    fetchPos();
  }, [fetchPos, view]);

  const awaitingCount = rows.filter((row) => row.awaitingApprovalAt).length;
  const visibleRows = awaitingOnly ? rows.filter((row) => row.awaitingApprovalAt) : rows;

  const columns: ColumnType<PoRow>[] = [
    {
      title: 'PO #',
      dataIndex: 'poNumber',
      render: (val: string, record: PoRow) => {
        // The DISPLAY title leads (David, 2026-08-06); the canonical poNumber
        // stays visible beneath when the two differ, since it is what URLs,
        // the portal and supplier emails reference.
        const title = poDisplayTitle(record);
        return (
          <div>
            <Link href={`/admin/purchase-orders/${record.id}`}>
              <Text strong style={{ fontFamily: 'monospace' }}>
                {title}
              </Text>
            </Link>
            {title !== val && (
              <div>
                <Text type="secondary" style={{ fontFamily: 'monospace', fontSize: 12 }}>
                  {val}
                </Text>
              </div>
            )}
          </div>
        );
      },
    },
    {
      title: 'Order #',
      dataIndex: 'orderNumber',
      width: 150,
      render: (val: string, record: PoRow) => (
        <div>
          <Link href={`/admin/orders/${record.orderId}`}>
            <Text style={{ fontFamily: 'monospace' }}>{val}</Text>
          </Link>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {record.customerName}
            </Text>
          </div>
        </div>
      ),
    },
    {
      title: 'Supplier',
      dataIndex: 'supplierName',
    },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 160,
      render: (val: string, record: PoRow) => (
        <Space direction="vertical" size={2}>
          <PoStatusBadge status={val} />
          {/* The flag rides ALONGSIDE the status, never replacing it — the PO
              is still in its phase, it is just parked with us. */}
          {record.awaitingApprovalAt && (
            <Tooltip
              title={`${record.awaitingApprovalBy ?? 'The supplier'} submitted this on ${formatDate(record.awaitingApprovalAt)}`}
            >
              <Tag icon={<HourglassOutlined />} color="orange" style={{ marginInlineEnd: 0 }}>
                Awaiting approval
              </Tag>
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: 'Rev',
      dataIndex: 'currentRevisionNumber',
      width: 70,
      render: (n: number) => <Tag>v{n}</Tag>,
    },
    {
      title: 'Deadline',
      dataIndex: 'deadlineDate',
      width: 120,
      render: (val: string | null) =>
        val ? formatDate(val) : <Text type="secondary">—</Text>,
    },
    {
      title: 'Expected ship',
      dataIndex: 'expectedShipDate',
      width: 130,
      render: (val: string | null) =>
        val ? formatDate(val) : <Text type="secondary">—</Text>,
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      width: 120,
      render: (val: string) => formatDate(val),
    },
  ];

  return (
    <div>
      <AdminPageHeader
        title="Purchase Orders"
        subtitle={
          view === 'table'
            ? `${visibleRows.length} purchase order${visibleRows.length !== 1 ? 's' : ''}`
            : undefined
        }
        extra={
          <Segmented
            value={view}
            onChange={(value) => setView(value as ViewMode)}
            size="large"
            options={[
              { label: 'Board', value: 'board', icon: <AppstoreOutlined /> },
              { label: 'Table', value: 'table', icon: <UnorderedListOutlined /> },
            ]}
          />
        }
      />

      {view === 'board' ? (
        <WorkflowBoard boardKey="purchase_order" />
      ) : (
      <Space direction="vertical" style={{ width: '100%' }} size={0}>
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <Input
            prefix={<SearchOutlined />}
            placeholder="Search PO, order, customer or supplier…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            allowClear
            style={{ maxWidth: 340 }}
          />
          <Select
            placeholder="All statuses"
            allowClear
            value={status}
            onChange={(v) => setStatus(v)}
            options={STATUS_OPTIONS}
            style={{ width: 180 }}
          />
          <Select
            placeholder="All suppliers"
            allowClear
            showSearch
            optionFilterProp="label"
            value={supplierId}
            onChange={(v) => setSupplierId(v)}
            options={(suppliers ?? []).map((s) => ({ value: s.id, label: s.name }))}
            style={{ width: 220 }}
          />
          {/* The awaiting-approval queue. Always visible (even at zero) so its
              absence reads as "nothing is waiting", not "the filter is gone". */}
          <Checkbox
            checked={awaitingOnly}
            onChange={(e) => setAwaitingOnly(e.target.checked)}
            style={{ alignSelf: 'center' }}
          >
            Awaiting approval only ({awaitingCount})
          </Checkbox>
        </div>

        <Table
          dataSource={visibleRows}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 20, showSizeChanger: false, hideOnSinglePage: true }}
          size="middle"
          locale={{
            emptyText: awaitingOnly
              ? 'Nothing is waiting for your approval.'
              : 'No purchase orders yet — create one from an order’s Production panel.',
          }}
        />
      </Space>
      )}
    </div>
  );
}
