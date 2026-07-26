'use client';

/**
 * Order-detail "Production" section: sizing-row coverage across purchase
 * orders + per-PO summary cards, fed by GET
 * /api/admin/orders/[id]/purchase-orders (getOrderProductionSummary). POs are
 * created here via CreatePoModal but managed on the dedicated PO pages.
 */
import { useMemo, useState } from 'react';
import { Alert, Button, Card, Empty, Progress, Space, Spin, Tag, Typography } from 'antd';
import { PlusOutlined, WarningOutlined } from '@ant-design/icons';
import Link from 'next/link';
import { PoStatusBadge } from '@/components/admin/purchase-orders/PoStatusBadge';
import type { PoVarianceCounts, ProductionSummary } from '@/types/production';
import { CreatePoModal, type PoModalGarment } from './CreatePoModal';

export type { ProductionSummary, ProductionPoSummary } from '@/types/production';

interface Props {
  orderId: string;
  orderStatus: string;
  colorSampleRequestedAt: string | null;
  /** The order's garments as known by the parent view — name fallback while the summary loads. */
  garments: Array<{ id: string; name: string }>;
  /**
   * Summary state is owned by OrderDetailView (see useProductionSummary) so the
   * rail badge, the garments warning and this panel always agree, and so an
   * edit elsewhere in the order refreshes them together.
   */
  summary: ProductionSummary | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

function varianceTagLabels(counts: PoVarianceCounts): string[] {
  const labels: string[] = [];
  if (counts.added > 0) labels.push(`+${counts.added} added`);
  if (counts.modified > 0) labels.push(`${counts.modified} modified`);
  if (counts.removed > 0) labels.push(`${counts.removed} removed`);
  return labels;
}

export function ProductionPanel({
  orderId,
  orderStatus,
  colorSampleRequestedAt,
  garments,
  summary: data,
  loading,
  error,
  reload,
}: Props) {
  const [createOpen, setCreateOpen] = useState(false);

  const garmentNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of garments) map.set(g.id, g.name);
    for (const g of data?.garments ?? []) map.set(g.id, g.name);
    return map;
  }, [garments, data]);

  // The modal's checklist: name + sizing-row count + "already fully covered" hint.
  const modalGarments: PoModalGarment[] = useMemo(() => {
    const source: Array<{ id: string; name: string; sizingRowCount: number }> =
      data?.garments ?? garments.map((g) => ({ ...g, sizingRowCount: 0 }));
    return source.map((g) => ({
      id: g.id,
      name: g.name,
      sizingRowCount: g.sizingRowCount,
      fullyCovered:
        g.sizingRowCount > 0 && (data?.coverage.uncoveredByGarment[g.id] ?? 0) === 0,
    }));
  }, [data, garments]);

  if (loading && !data) {
    return (
      <div style={{ textAlign: 'center', padding: 32 }}>
        <Spin />
      </div>
    );
  }

  if (error && !data) {
    return <Alert type="error" showIcon message={error} />;
  }

  const coverage = data?.coverage;
  const pos = data?.purchaseOrders ?? [];
  const uncoveredEntries = Object.entries(coverage?.uncoveredByGarment ?? {});

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Typography.Title level={5} style={{ margin: 0, flex: 1 }}>
          Production
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
          Create purchase order
        </Button>
      </div>

      {coverage && (
        <Card size="small" title="Sizing-row coverage">
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            {coverage.totalRows === 0 ? (
              <Typography.Text type="secondary">
                This order has no sizing rows yet — add sizing before raising purchase orders.
              </Typography.Text>
            ) : (
              <>
                <Typography.Text>
                  {coverage.coveredRows} of {coverage.totalRows} sizing rows covered
                </Typography.Text>
                <Progress
                  percent={coverage.percentage}
                  status={coverage.percentage === 100 ? 'success' : 'active'}
                />
              </>
            )}
            {uncoveredEntries.length > 0 && (
              <div>
                {uncoveredEntries.map(([garmentId, count]) => (
                  <Typography.Text
                    key={garmentId}
                    type="warning"
                    style={{ display: 'block', fontSize: 13 }}
                  >
                    <WarningOutlined style={{ marginRight: 6 }} />
                    {garmentNameById.get(garmentId) ?? 'Unknown garment'} — {count}{' '}
                    {count === 1 ? 'row' : 'rows'} uncovered
                  </Typography.Text>
                ))}
              </div>
            )}
          </Space>
        </Card>
      )}

      {pos.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No purchase orders yet for this order"
        />
      ) : (
        pos.map((po) => {
          const tags = varianceTagLabels(po.varianceCounts);
          return (
            <Card key={po.id} size="small">
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Space wrap size={8}>
                  <Link href={`/admin/purchase-orders/${po.id}`}>
                    <Typography.Text strong style={{ color: 'inherit' }}>
                      {po.poNumber}
                    </Typography.Text>
                  </Link>
                  <PoStatusBadge status={po.status} />
                  <Tag>v{po.currentRevisionNumber}</Tag>
                  <Typography.Text type="secondary">{po.supplier.name}</Typography.Text>
                </Space>
                {tags.length > 0 && (
                  <Space wrap size={4}>
                    <Typography.Text type="warning" style={{ fontSize: 13 }}>
                      Order changed since this PO was issued:
                    </Typography.Text>
                    {tags.map((label) => (
                      <Tag key={label} color="warning">
                        {label}
                      </Tag>
                    ))}
                    <Link href={`/admin/purchase-orders/${po.id}`}>Review on PO page</Link>
                  </Space>
                )}
              </Space>
            </Card>
          );
        })
      )}

      {createOpen && (
        <CreatePoModal
          open
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            reload();
          }}
          orderId={orderId}
          orderStatus={orderStatus}
          colorSampleRequestedAt={colorSampleRequestedAt}
          garments={modalGarments}
        />
      )}
    </Space>
  );
}
