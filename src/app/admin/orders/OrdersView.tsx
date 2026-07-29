'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Table,
  Button,
  Input,
  Segmented,
  Space,
  Typography,
  Tabs,
  Tooltip,
  App,
} from 'antd';
import {
  FileAddOutlined,
  SearchOutlined,
  DownloadOutlined,
  BgColorsOutlined,
  AppstoreOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import Link from 'next/link';
import type { ColumnType } from 'antd/es/table';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { WorkflowBoard } from '@/components/admin/workflow/WorkflowBoard';
import { OrderStatusBadge } from '@/components/admin/orders/OrderStatusBadge';
import { ORDER_STATUS } from '@/lib/status';
import { formatDate, formatCurrency } from '@/lib/format';
import { getJson } from '@/lib/api-fetch';
import { SEMANTIC } from '@/lib/semantic-colors';

type SortField = 'createdAt' | 'orderValueAmount';
type SortDirection = 'ascend' | 'descend' | null;

interface OrderRow {
  id: string;
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  clubName: string | null;
  status: string;
  orderValueAmount: string | null;
  orderValueCurrency: string | null;
  createdAt: string;
  confirmedAt: string | null;
  colorSampleRequestedAt: string | null;
}

const STATUS_TABS = [
  { key: '', label: 'All' },
  ...Object.entries(ORDER_STATUS).map(([key, meta]) => ({ key, label: meta.label })),
];

type ViewMode = 'board' | 'table';

interface Props {
  /** Which view to open on. Overridable so tests can target one directly. */
  initialView?: ViewMode;
}

export function OrdersView({ initialView = 'board' }: Props = {}) {
  const { message } = App.useApp();
  const router = useRouter();
  const searchParams = useSearchParams();
  /**
   * The board is the landing view; the table is still here for the things a
   * board is bad at — finding one order among hundreds, sorting by value, and
   * exporting.
   */
  const [view, setView] = useState<ViewMode>(initialView);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState(() => searchParams.get('status') ?? '');
  const [sortField, setSortField] = useState<SortField | null>(() => {
    const initialSortBy = searchParams.get('sortBy');
    return initialSortBy === 'createdAt' || initialSortBy === 'orderValueAmount'
      ? initialSortBy
      : null;
  });
  const [sortOrder, setSortOrder] = useState<SortDirection>(() => {
    const initialSortDir = searchParams.get('sortDir');
    return initialSortDir === 'asc' ? 'ascend' : initialSortDir === 'desc' ? 'descend' : null;
  });
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String((page - 1) * PAGE_SIZE),
      });
      if (status) params.set('status', status);
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (sortField && sortOrder) {
        params.set('sortBy', sortField);
        params.set('sortDir', sortOrder === 'ascend' ? 'asc' : 'desc');
      }

      const data = await getJson<{ orders: OrderRow[]; total: number }>(
        `/api/admin/orders?${params}`,
        'Failed to load',
      );
      setOrders(data.orders);
      setTotal(data.total);
    } catch {
      message.error('Failed to load orders');
    } finally {
      setLoading(false);
    }
  }, [status, debouncedSearch, page, sortField, sortOrder, message]);

  // Only the table needs this data — the board loads its own columns, so in
  // board view this request would be work nobody looks at.
  useEffect(() => {
    if (view !== 'table') return;
    fetchOrders();
  }, [fetchOrders, view]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [status, debouncedSearch, sortField, sortOrder]);

  const exportHref = (() => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (sortField && sortOrder) {
      params.set('sortBy', sortField);
      params.set('sortDir', sortOrder === 'ascend' ? 'asc' : 'desc');
    }
    const qs = params.toString();
    return `/api/admin/orders/export${qs ? `?${qs}` : ''}`;
  })();

  const columns: ColumnType<OrderRow>[] = [
    {
      title: 'Order #',
      dataIndex: 'orderNumber',
      width: 130,
      render: (val: string) => (
        <Typography.Text strong style={{ fontFamily: 'monospace' }}>
          {val}
        </Typography.Text>
      ),
    },
    {
      title: 'Customer',
      dataIndex: 'customerName',
      render: (name: string, record: OrderRow) => (
        <div>
          <div>{name}</div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {record.customerEmail}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: 'Club',
      dataIndex: 'clubName',
      render: (val: string | null) => val ?? <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 160,
      render: (val: string, record: OrderRow) => (
        <Space size={6}>
          <OrderStatusBadge status={val} />
          {record.colorSampleRequestedAt && (
            <Tooltip title="Colour book / sample requested — hold production">
              <BgColorsOutlined style={{ color: SEMANTIC.hold }} />
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: 'Value',
      dataIndex: 'orderValueAmount',
      width: 120,
      sorter: true,
      sortOrder: sortField === 'orderValueAmount' ? sortOrder : null,
      render: (amount: string | null, record: OrderRow) =>
        amount
          ? `${record.orderValueCurrency ?? 'NZD'} ${formatCurrency(amount)}`
          : <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      width: 140,
      sorter: true,
      sortOrder: sortField === 'createdAt' ? sortOrder : null,
      render: (val: string) => formatDate(val),
    },
  ];

  return (
    <div>
      <AdminPageHeader
        title="Orders"
        subtitle={view === 'table' ? `${total} order${total !== 1 ? 's' : ''} total` : undefined}
        extra={
          <Space>
            <Segmented
              value={view}
              onChange={(value) => setView(value as ViewMode)}
              size="large"
              options={[
                { label: 'Board', value: 'board', icon: <AppstoreOutlined /> },
                { label: 'Table', value: 'table', icon: <UnorderedListOutlined /> },
              ]}
            />
            {/* Export follows the table's filters, so it is offered only where
                those filters are visible — otherwise it would silently carry
                whatever was last selected. */}
            {view === 'table' && (
              <a href={exportHref}>
                <Button icon={<DownloadOutlined />} size="large">
                  Export CSV
                </Button>
              </a>
            )}
            <Link href="/admin/orders/new">
              <Button type="primary" icon={<FileAddOutlined />} size="large">
                New Order
              </Button>
            </Link>
          </Space>
        }
      />

      {view === 'board' ? (
        <WorkflowBoard boardKey="order" />
      ) : (
      <Space direction="vertical" style={{ width: '100%' }} size={0}>
        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          <Input
            prefix={<SearchOutlined />}
            placeholder="Search by name, email or order number…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            allowClear
            style={{ maxWidth: 380 }}
          />
        </div>

        <Tabs
          activeKey={status}
          onChange={(key) => setStatus(key)}
          items={STATUS_TABS.map((t) => ({ key: t.key, label: t.label }))}
          style={{ marginBottom: 0 }}
        />

        <Table
          dataSource={orders}
          columns={columns}
          rowKey="id"
          loading={loading}
          onChange={(_, __, sorter) => {
            if (Array.isArray(sorter)) return;

            const field = sorter.field;
            if (field === 'createdAt' || field === 'orderValueAmount') {
              setSortField(field);
              setSortOrder(sorter.order === 'ascend' || sorter.order === 'descend' ? sorter.order : null);
            } else {
              setSortField(null);
              setSortOrder(null);
            }
          }}
          pagination={{
            current: page,
            pageSize: PAGE_SIZE,
            total,
            onChange: (p) => setPage(p),
            showSizeChanger: false,
            showTotal: (t) => `${t} orders`,
          }}
          onRow={(record) => ({
            onClick: () => router.push(`/admin/orders/${record.id}`),
            style: { cursor: 'pointer' },
          })}
          size="middle"
        />
      </Space>
      )}
    </div>
  );
}
