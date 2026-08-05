'use client';

/**
 * Supplier portal home (David, 2026-08-05): after the shared-password login,
 * a filterable/sortable table of ALL the supplier's sent POs, with per-row and
 * multi-select bulk status changes. Each PO number links to the pretty per-PO
 * page (/supplier/po/[poNumber]).
 *
 * Auth is the signed supplier cookie: the first GET answering 401
 * login_required swaps in the login card, and login replays the load.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { App, Alert, Button, Card, Dropdown, Input, Space, Spin, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DownOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { ApiError, getJson, postJson } from '@/lib/api-fetch';
import { formatDate } from '@/lib/format';
import { poStatusMeta } from '@/lib/status';
import { PO_STATUSES } from '@/server/purchase-orders/contract';
import {
  SUPPLIER_ALLOWED_STATUSES,
  type SupplierAllowedStatus,
} from '@/server/supplier-portal/contract';
import type { SupplierPoListRow } from '@/server/supplier-portal/service';
import { CustomerPageShell } from '@/components/customer/CustomerPageShell';
import { CARD_STYLE, CARD_BODY_STYLES } from '@/components/customer/customerStyles';
import { SupplierLoginCard } from '@/components/supplier/SupplierLoginCard';
import { matchesPoSearch, summarizeStatusResults } from '@/components/supplier/po-view-helpers';

const { Text } = Typography;

type Phase = 'loading' | 'login' | 'ready' | 'error';

interface PosResponse {
  items: SupplierPoListRow[];
  supplierName: string;
  name: string;
}

interface StatusResults {
  results: { poNumber: string; ok: boolean; status?: string; error?: string }[];
}

/** Chain position for the status sorter — unknown/legacy values sort last. */
function statusRank(status: string): number {
  const index = (PO_STATUSES as readonly string[]).indexOf(status);
  return index === -1 ? PO_STATUSES.length : index;
}

export function SupplierPortalHomeView({ code }: { code: string }) {
  const { message } = App.useApp();
  const [phase, setPhase] = useState<Phase>('loading');
  const [items, setItems] = useState<SupplierPoListRow[]>([]);
  const [supplierName, setSupplierName] = useState('');
  const [personName, setPersonName] = useState('');
  const [search, setSearch] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [applying, setApplying] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await getJson<PosResponse>(
        `/api/supplier/${encodeURIComponent(code)}/pos`,
        'Failed to load purchase orders',
      );
      setItems(data.items);
      setSupplierName(data.supplierName);
      setPersonName(data.name);
      setPhase('ready');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setPhase('login');
      } else {
        setPhase('error');
      }
    }
  }, [code]);

  useEffect(() => {
    void load();
  }, [load]);

  async function applyStatus(poNumbers: string[], status: SupplierAllowedStatus) {
    setApplying(true);
    try {
      const { results } = await postJson<StatusResults>(
        `/api/supplier/${encodeURIComponent(code)}/status`,
        { poNumbers, status },
        'Failed to update status',
      );
      const { okCount, failures } = summarizeStatusResults(results);
      const label = poStatusMeta(status).label;
      if (okCount > 0) {
        message.success(
          okCount === 1 && poNumbers.length === 1
            ? `${poNumbers[0]} moved to ${label}`
            : `${okCount} purchase order${okCount === 1 ? '' : 's'} moved to ${label}`,
        );
      }
      if (failures.length > 0) {
        message.warning(`Not updated — ${failures.join('; ')}`, 6);
      }
      setSelectedKeys([]);
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setPhase('login');
      } else {
        message.error(err instanceof Error ? err.message : 'Failed to update status');
      }
    } finally {
      setApplying(false);
    }
  }

  if (phase === 'loading') {
    return (
      <CustomerPageShell label="Supplier Portal" title="Purchase orders">
        <div style={{ textAlign: 'center', padding: 60 }}>
          <Spin size="large" />
        </div>
      </CustomerPageShell>
    );
  }

  if (phase === 'login') {
    return (
      <CustomerPageShell label="Supplier Portal" title="Welcome" subtitle="Sign in to see your purchase orders">
        <SupplierLoginCard
          code={code}
          onSuccess={({ name, supplierName: sn }) => {
            setPersonName(name);
            setSupplierName(sn);
            setPhase('loading');
            void load();
          }}
        />
      </CustomerPageShell>
    );
  }

  if (phase === 'error') {
    return (
      <CustomerPageShell label="Supplier Portal" title="Purchase orders">
        <Card style={CARD_STYLE} styles={CARD_BODY_STYLES}>
          <Alert
            type="error"
            showIcon
            message="Something went wrong loading your purchase orders."
            action={
              <Button icon={<ReloadOutlined />} onClick={() => void load()}>
                Retry
              </Button>
            }
          />
        </Card>
      </CustomerPageShell>
    );
  }

  const visible = items.filter((row) => matchesPoSearch(row, search));
  const statusesInData = [...new Set(items.map((row) => row.status))];

  const columns: ColumnsType<SupplierPoListRow> = [
    {
      title: 'PO number',
      dataIndex: 'poNumber',
      sorter: (a, b) => a.poNumber.localeCompare(b.poNumber),
      render: (poNumber: string) => (
        <Link href={`/supplier/po/${encodeURIComponent(poNumber)}`} style={{ fontWeight: 600 }}>
          {poNumber}
        </Link>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      sorter: (a, b) => statusRank(a.status) - statusRank(b.status),
      filters: statusesInData.map((status) => ({
        text: poStatusMeta(status).label,
        value: status,
      })),
      onFilter: (value, row) => row.status === value,
      render: (status: string) => {
        const meta = poStatusMeta(status);
        return <Tag color={meta.tag}>{meta.label}</Tag>;
      },
    },
    {
      title: 'Garments',
      dataIndex: 'garmentNames',
      render: (names: string[]) =>
        names.length > 0 ? names.join(', ') : <Text type="secondary">—</Text>,
    },
    {
      title: 'Units',
      dataIndex: 'totalUnits',
      width: 80,
      sorter: (a, b) => a.totalUnits - b.totalUnits,
    },
    {
      title: 'Expected ship',
      dataIndex: 'expectedShipDate',
      // YYYY-MM-DD compares correctly as a string; missing dates sort last.
      sorter: (a, b) => (a.expectedShipDate ?? '9999').localeCompare(b.expectedShipDate ?? '9999'),
      render: (v: string | null) => (v ? formatDate(v) : <Text type="secondary">—</Text>),
    },
    {
      title: 'Shipped',
      dataIndex: 'actualShipDate',
      sorter: (a, b) => (a.actualShipDate ?? '9999').localeCompare(b.actualShipDate ?? '9999'),
      render: (v: string | null) => (v ? formatDate(v) : <Text type="secondary">—</Text>),
    },
    {
      title: 'Sent',
      dataIndex: 'sentAt',
      sorter: (a, b) => (a.sentAt ?? '9999').localeCompare(b.sentAt ?? '9999'),
      render: (v: string | null) => (v ? formatDate(v) : <Text type="secondary">—</Text>),
    },
    {
      title: 'Rev',
      dataIndex: 'revisionNumber',
      width: 60,
      sorter: (a, b) => a.revisionNumber - b.revisionNumber,
    },
    {
      title: '',
      key: 'actions',
      width: 130,
      render: (_, row) =>
        row.allowedNextStatuses.length > 0 ? (
          <Dropdown
            disabled={applying}
            menu={{
              items: row.allowedNextStatuses.map((status) => ({
                key: status,
                label: `Move to ${poStatusMeta(status).label}`,
              })),
              onClick: ({ key }) => void applyStatus([row.poNumber], key as SupplierAllowedStatus),
            }}
          >
            <Button size="small">
              Update status <DownOutlined />
            </Button>
          </Dropdown>
        ) : null,
    },
  ];

  return (
    <CustomerPageShell
      label="Supplier Portal"
      title={supplierName || 'Purchase orders'}
      subtitle={personName ? `Signed in as ${personName}` : undefined}
    >
      <Card style={CARD_STYLE} styles={CARD_BODY_STYLES}>
        <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }} wrap>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="Search PO number or garment…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 280 }}
          />
          {selectedKeys.length > 0 && (
            <Space>
              <Text style={{ color: 'rgba(255,255,255,0.65)' }}>
                {selectedKeys.length} selected
              </Text>
              <Dropdown
                disabled={applying}
                menu={{
                  items: SUPPLIER_ALLOWED_STATUSES.map((status) => ({
                    key: status,
                    label: `Move to ${poStatusMeta(status).label}`,
                  })),
                  onClick: ({ key }) =>
                    void applyStatus(
                      selectedKeys.map(String),
                      key as SupplierAllowedStatus,
                    ),
                }}
              >
                <Button type="primary" loading={applying}>
                  Set status <DownOutlined />
                </Button>
              </Dropdown>
              <Button onClick={() => setSelectedKeys([])} disabled={applying}>
                Clear
              </Button>
            </Space>
          )}
        </Space>

        <Table
          dataSource={visible}
          columns={columns}
          rowKey="poNumber"
          size="middle"
          pagination={visible.length > 25 ? { pageSize: 25 } : false}
          scroll={{ x: 'max-content' }}
          rowSelection={{
            selectedRowKeys: selectedKeys,
            onChange: (keys) => setSelectedKeys(keys),
          }}
          locale={{ emptyText: search ? 'No purchase orders match your search' : 'No purchase orders yet' }}
        />
      </Card>
    </CustomerPageShell>
  );
}
