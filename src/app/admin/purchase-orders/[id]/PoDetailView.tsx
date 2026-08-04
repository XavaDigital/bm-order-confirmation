'use client';

/**
 * Purchase-order detail (PO_PLAN): header actions (send / PDF / status
 * machine), variance banner + revision issuing, editable dates/notes, the
 * latest-revision line tables, revision history, and a shipments placeholder.
 *
 * Data: the client loads GET /api/admin/purchase-orders/[id] for the PO
 * itself, and sources VARIANCE from the parent order's production-summary
 * endpoint (GET /api/admin/orders/[orderId]/purchase-orders), which already
 * computes per-PO live variance + counts — no bespoke variance endpoint.
 * Status actions offer ONLY the transitions `canTransition` allows (the same
 * pure function the service guards with), so the UI can never offer an
 * illegal move — including remake's two re-entry options.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Collapse,
  DatePicker,
  Dropdown,
  Input,
  Modal,
  Popconfirm,
  Space,
  Spin,
  Table,
  Tag,
  Timeline,
  Tooltip,
  Typography,
} from 'antd';
import {
  CopyOutlined,
  DownOutlined,
  DownloadOutlined,
  FileExcelOutlined,
  LinkOutlined,
  MailOutlined,
  PaperClipOutlined,
  StopOutlined,
} from '@ant-design/icons';
import Link from 'next/link';
import dayjs, { type Dayjs } from 'dayjs';
import type { ColumnType } from 'antd/es/table';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { PoStatusBadge } from '@/components/admin/purchase-orders/PoStatusBadge';
import { ShipmentStatusBadge } from '@/components/admin/purchase-orders/ShipmentStatusBadge';
import { VarianceDiff } from '@/components/admin/purchase-orders/VarianceDiff';
import { PO_STATUSES, canTransition, type PoStatus } from '@/server/purchase-orders/contract';
import {
  sizeSummary,
  type PoVariance,
  type PoVarianceCounts,
} from '@/server/purchase-orders/snapshot';
import type { PoSnapshot, PoSnapshotAsset, PoSnapshotLine } from '@/db/schema';
import { PO_STATUS } from '@/lib/status';
import { ASSET_KIND_COLOR, ASSET_KIND_LABEL } from '@/lib/asset-kind';
import { formatDate } from '@/lib/format';
import { getJson, postJson, patchJson, deleteJson } from '@/lib/api-fetch';

const { Text } = Typography;

interface PoRevision {
  id: string;
  revisionNumber: number;
  reason: string | null;
  snapshot: PoSnapshot;
  createdAt: string;
}

interface PoShipment {
  id: string;
  nickname: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  status: string;
}

interface PoDetail {
  id: string;
  poNumber: string;
  orderId: string;
  status: string;
  currentRevisionNumber: number;
  deadlineDate: string | null;
  expectedShipDate: string | null;
  actualShipDate: string | null;
  sentAt: string | null;
  receivedAt: string | null;
  notes: string | null;
  createdAt: string;
  supplier: {
    id: string;
    name: string;
    contactPerson: string | null;
    email: string | null;
    phone: string | null;
  };
  order: { id: string; orderNumber: string; customerName: string; status: string };
  revisions: PoRevision[];
  shipments: PoShipment[];
  supplierLink: { active: boolean; lastViewedAt: string | null };
}

interface ProductionSummary {
  purchaseOrders: Array<{
    id: string;
    variance: PoVariance;
    varianceCounts: PoVarianceCounts;
  }>;
}

const LINE_COLUMNS: ColumnType<PoSnapshotLine>[] = [
  {
    title: 'Size',
    dataIndex: 'size',
    width: 120,
    render: (v: string | null) => v ?? <Text type="secondary">—</Text>,
  },
  {
    title: 'Player',
    dataIndex: 'playerName',
    render: (v: string | null) => v ?? <Text type="secondary">—</Text>,
  },
  {
    title: 'Number',
    dataIndex: 'playerNumber',
    width: 110,
    render: (v: string | null) => v ?? <Text type="secondary">—</Text>,
  },
  {
    title: 'Notes',
    dataIndex: 'notes',
    render: (v: string | null) => v ?? <Text type="secondary">—</Text>,
  },
];

export function PoDetailView({ poId }: { poId: string }) {
  const { message, modal } = App.useApp();
  const [detail, setDetail] = useState<PoDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [varianceInfo, setVarianceInfo] = useState<{
    variance: PoVariance;
    counts: PoVarianceCounts;
  } | null>(null);

  const [sending, setSending] = useState(false);
  const [revisionModalOpen, setRevisionModalOpen] = useState(false);
  const [revisionReason, setRevisionReason] = useState('');
  const [issuingRevision, setIssuingRevision] = useState(false);

  // Editable summary fields
  const [deadline, setDeadline] = useState<Dayjs | null>(null);
  const [expectedShip, setExpectedShip] = useState<Dayjs | null>(null);
  const [actualShip, setActualShip] = useState<Dayjs | null>(null);
  const [notes, setNotes] = useState('');
  const [savingSummary, setSavingSummary] = useState(false);

  // Supplier portal link — shown once when (re)generated, matching ShareLinkPanel's
  // "copy now" convention (the raw token is never persisted after creation).
  const [supplierLinkUrl, setSupplierLinkUrl] = useState<string | null>(null);
  const [supplierLinkBusy, setSupplierLinkBusy] = useState<'generate' | 'revoke' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await getJson<PoDetail>(
        `/api/admin/purchase-orders/${poId}`,
        'Failed to load purchase order',
      );
      setDetail(d);
      setDeadline(d.deadlineDate ? dayjs(d.deadlineDate) : null);
      setExpectedShip(d.expectedShipDate ? dayjs(d.expectedShipDate) : null);
      setActualShip(d.actualShipDate ? dayjs(d.actualShipDate) : null);
      setNotes(d.notes ?? '');
      // Variance is best-effort — the page still works if the summary fails.
      try {
        const summary = await getJson<ProductionSummary>(
          `/api/admin/orders/${d.orderId}/purchase-orders`,
          'Failed to load variance',
        );
        const entry = summary.purchaseOrders.find((p) => p.id === poId);
        setVarianceInfo(
          entry ? { variance: entry.variance, counts: entry.varianceCounts } : null,
        );
      } catch {
        setVarianceInfo(null);
      }
    } catch {
      message.error('Failed to load purchase order');
    } finally {
      setLoading(false);
    }
  }, [poId, message]);

  useEffect(() => {
    load();
  }, [load]);

  async function sendToSupplier() {
    setSending(true);
    try {
      const res = await postJson<{ ok: true; poNumber: string; to: string }>(
        `/api/admin/purchase-orders/${poId}/send`,
        {},
        'Failed to send purchase order',
      );
      message.success(`Purchase order emailed to ${res.to}`);
      await load();
    } catch (err) {
      // 503 (email unconfigured), 409 (guards) and 500 (SMTP) all carry a
      // human-readable message from the server.
      message.error(err instanceof Error ? err.message : 'Failed to send purchase order');
    } finally {
      setSending(false);
    }
  }

  async function applyStatus(next: PoStatus) {
    try {
      await postJson(
        `/api/admin/purchase-orders/${poId}/status`,
        { status: next },
        'Failed to update status',
      );
      message.success(`Status updated to ${PO_STATUS[next].label}`);
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to update status');
    }
  }

  async function issueRevision() {
    const reason = revisionReason.trim();
    if (reason.length < 1 || reason.length > 500) {
      message.error('Enter a reason (1–500 characters)');
      return;
    }
    setIssuingRevision(true);
    try {
      await postJson(
        `/api/admin/purchase-orders/${poId}/revisions`,
        { reason },
        'Failed to issue revision',
      );
      message.success('Revision issued');
      setRevisionModalOpen(false);
      setRevisionReason('');
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to issue revision');
    } finally {
      setIssuingRevision(false);
    }
  }

  async function saveSummary() {
    setSavingSummary(true);
    try {
      await patchJson(
        `/api/admin/purchase-orders/${poId}`,
        {
          deadlineDate: deadline ? deadline.format('YYYY-MM-DD') : null,
          expectedShipDate: expectedShip ? expectedShip.format('YYYY-MM-DD') : null,
          actualShipDate: actualShip ? actualShip.format('YYYY-MM-DD') : null,
          notes: notes.trim() || null,
        },
        'Failed to save',
      );
      message.success('Saved');
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSavingSummary(false);
    }
  }

  async function generateSupplierLink() {
    setSupplierLinkBusy('generate');
    try {
      const { url } = await postJson<{ url: string }>(
        `/api/admin/purchase-orders/${poId}/supplier-link`,
        undefined,
        'Failed to generate supplier link',
      );
      setSupplierLinkUrl(url);
      message.success('Supplier portal link generated');
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to generate supplier link');
    } finally {
      setSupplierLinkBusy(null);
    }
  }

  async function revokeSupplierLink() {
    setSupplierLinkBusy('revoke');
    try {
      await deleteJson(
        `/api/admin/purchase-orders/${poId}/supplier-link`,
        undefined,
        'Failed to revoke supplier link',
      );
      setSupplierLinkUrl(null);
      message.success('Supplier portal link revoked');
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to revoke supplier link');
    } finally {
      setSupplierLinkBusy(null);
    }
  }

  async function copySupplierLink() {
    if (!supplierLinkUrl) return;
    try {
      await navigator.clipboard.writeText(supplierLinkUrl);
      message.success('Link copied to clipboard');
    } catch {
      message.error('Copy failed — please copy manually');
    }
  }

  if (loading && !detail) {
    return (
      <div style={{ textAlign: 'center', padding: 64 }}>
        <Spin size="large" />
      </div>
    );
  }
  if (!detail) {
    return <Alert type="error" message="Failed to load purchase order" showIcon />;
  }

  const latest = detail.revisions[0]; // newest first
  const summary = sizeSummary(latest.snapshot);
  const summaryByGarment = new Map(summary.perGarment.map((g) => [g.garmentId, g]));

  const legalTransitions = PO_STATUSES.filter((s) =>
    canTransition(detail.status as PoStatus, s),
  );
  const supplierHasEmail = Boolean(detail.supplier.email);
  const canSend = detail.status === 'draft' || detail.status === 'sent';

  const sendButton = (
    <Button icon={<MailOutlined />} loading={sending} disabled={!supplierHasEmail || !canSend}>
      Send to supplier
    </Button>
  );

  return (
    <div>
      <AdminPageHeader
        title={
          <Space size={12}>
            <span style={{ fontFamily: 'monospace' }}>{detail.poNumber}</span>
            <PoStatusBadge status={detail.status} />
            <Tag>v{detail.currentRevisionNumber}</Tag>
          </Space>
        }
        subtitle={
          <>
            {detail.supplier.name} · order{' '}
            <Link href={`/admin/orders/${detail.orderId}`}>{detail.order.orderNumber}</Link> (
            {detail.order.customerName})
          </>
        }
        extra={
          <Space>
            {supplierHasEmail && canSend ? (
              <Popconfirm
                title="Send to supplier"
                description={`Email the latest revision (v${detail.currentRevisionNumber}) to ${detail.supplier.email}?`}
                onConfirm={sendToSupplier}
                okText="Send"
              >
                {sendButton}
              </Popconfirm>
            ) : (
              <Tooltip
                title={
                  !supplierHasEmail
                    ? 'Supplier has no email address'
                    : `A ${PO_STATUS[detail.status as PoStatus]?.label.toLowerCase() ?? detail.status} purchase order cannot be sent`
                }
              >
                {sendButton}
              </Tooltip>
            )}
            <a href={`/api/admin/purchase-orders/${poId}/pdf`}>
              <Button icon={<DownloadOutlined />}>Download PDF</Button>
            </a>
            <a href={`/api/admin/purchase-orders/${poId}/xlsx`}>
              <Button icon={<FileExcelOutlined />}>Download XLSX</Button>
            </a>
            {legalTransitions.length > 0 && (
              <Dropdown
                trigger={['click']}
                menu={{
                  items: legalTransitions.map((s) => ({
                    key: s,
                    label: PO_STATUS[s].label,
                    danger: s === 'cancelled',
                  })),
                  onClick: ({ key }) => {
                    const next = key as PoStatus;
                    if (next === 'cancelled') {
                      modal.confirm({
                        title: 'Cancel this purchase order?',
                        content:
                          'A cancelled purchase order is terminal — it cannot be reactivated, and its sizing rows stop counting as covered.',
                        okText: 'Cancel purchase order',
                        okButtonProps: { danger: true },
                        cancelText: 'Keep',
                        onOk: () => applyStatus(next),
                      });
                    } else {
                      applyStatus(next);
                    }
                  },
                }}
              >
                <Button type="primary">
                  Advance status <DownOutlined />
                </Button>
              </Dropdown>
            )}
          </Space>
        }
      />

      {varianceInfo?.variance.hasVariance && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={`Order has changed since revision ${latest.revisionNumber} — ${varianceInfo.counts.added} added / ${varianceInfo.counts.modified} modified / ${varianceInfo.counts.removed} removed`}
          action={
            <Button size="small" type="primary" onClick={() => setRevisionModalOpen(true)}>
              Issue revision
            </Button>
          }
          description={
            <Collapse
              ghost
              size="small"
              items={[
                {
                  key: 'diff',
                  label: 'View differences',
                  children: <VarianceDiff variance={varianceInfo.variance} />,
                },
              ]}
            />
          }
        />
      )}

      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Card title="Summary" size="small">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            <div>
              <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                Supplier
              </Text>
              <div>
                <Text strong>{detail.supplier.name}</Text>
              </div>
              {detail.supplier.contactPerson && <div>{detail.supplier.contactPerson}</div>}
              <div>
                {detail.supplier.email ?? <Text type="secondary">No email address</Text>}
              </div>
              {detail.supplier.phone && <div>{detail.supplier.phone}</div>}
              <div style={{ marginTop: 12 }}>
                <Text type="secondary">Order: </Text>
                <Link href={`/admin/orders/${detail.orderId}`}>{detail.order.orderNumber}</Link>
              </div>
              {detail.sentAt && (
                <div style={{ marginTop: 4 }}>
                  <Text type="secondary">First sent: {formatDate(detail.sentAt)}</Text>
                </div>
              )}
            </div>
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div>
                  <Text strong style={{ display: 'block', marginBottom: 4 }}>
                    Deadline
                  </Text>
                  <DatePicker
                    style={{ width: '100%' }}
                    format="DD MMM YYYY"
                    value={deadline}
                    onChange={setDeadline}
                  />
                </div>
                <div>
                  <Text strong style={{ display: 'block', marginBottom: 4 }}>
                    Expected ship
                  </Text>
                  <DatePicker
                    style={{ width: '100%' }}
                    format="DD MMM YYYY"
                    value={expectedShip}
                    onChange={setExpectedShip}
                  />
                </div>
                <div>
                  <Text strong style={{ display: 'block', marginBottom: 4 }}>
                    Actual ship
                  </Text>
                  <DatePicker
                    style={{ width: '100%' }}
                    format="DD MMM YYYY"
                    value={actualShip}
                    onChange={setActualShip}
                  />
                </div>
              </div>
              <div style={{ marginTop: 12 }}>
                <Text strong style={{ display: 'block', marginBottom: 4 }}>
                  Notes to supplier
                </Text>
                <Input.TextArea
                  rows={3}
                  maxLength={2000}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Anything the supplier needs to know"
                />
              </div>
              <div style={{ marginTop: 12, textAlign: 'right' }}>
                <Button type="primary" loading={savingSummary} onClick={saveSummary}>
                  Save
                </Button>
              </div>
            </div>
          </div>
        </Card>

        <Card title="Supplier Portal" size="small">
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              A token-gated link the supplier can open to view this purchase order, push its
              status forward, and leave a comment. Minted automatically the first time a PO is
              sent — regenerate below only if the link needs replacing.
            </Text>

            {detail.supplierLink.active && !supplierLinkUrl && (
              <Alert
                type="warning"
                showIcon
                icon={<LinkOutlined />}
                message={
                  <span>
                    Active link exists — URL not shown
                    {detail.supplierLink.lastViewedAt && (
                      <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                        (last viewed {formatDate(detail.supplierLink.lastViewedAt)})
                      </Text>
                    )}
                  </span>
                }
                description="The link is only displayed once when it's generated. Regenerate to get a new copyable URL — this invalidates the current one."
              />
            )}

            {!detail.supplierLink.active && !supplierLinkUrl && (
              <Alert
                type="info"
                showIcon
                message="No supplier link yet"
                description="One is generated automatically the next time this PO is sent, or generate one now."
              />
            )}

            {supplierLinkUrl && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <Text strong>Supplier link</Text>
                  <Text type="warning" style={{ fontSize: 12 }}>
                    — copy now, this won&apos;t be shown again after you leave this page
                  </Text>
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 12px',
                    background: 'var(--ant-color-fill-tertiary)',
                    borderRadius: 6,
                    border: '1px solid var(--ant-color-warning-border, var(--ant-color-border))',
                  }}
                >
                  <LinkOutlined style={{ color: 'var(--ant-color-primary)', flexShrink: 0 }} />
                  <Text style={{ flex: 1, wordBreak: 'break-all', fontSize: 13 }}>
                    {supplierLinkUrl}
                  </Text>
                  <Button type="primary" size="small" icon={<CopyOutlined />} onClick={copySupplierLink}>
                    Copy
                  </Button>
                </div>
              </div>
            )}

            <Space wrap>
              <Tooltip
                title={
                  detail.supplierLink.active
                    ? 'Creates a new URL and invalidates the existing one'
                    : undefined
                }
              >
                <Button
                  icon={<LinkOutlined />}
                  loading={supplierLinkBusy === 'generate'}
                  disabled={supplierLinkBusy !== null && supplierLinkBusy !== 'generate'}
                  onClick={generateSupplierLink}
                >
                  {detail.supplierLink.active ? 'Regenerate link' : 'Generate link'}
                </Button>
              </Tooltip>
              {detail.supplierLink.active && (
                <Popconfirm
                  title="Revoke supplier link?"
                  description="The current URL will stop working immediately."
                  onConfirm={revokeSupplierLink}
                  okText="Revoke"
                  okType="danger"
                  disabled={supplierLinkBusy !== null}
                >
                  <Button
                    danger
                    icon={<StopOutlined />}
                    loading={supplierLinkBusy === 'revoke'}
                    disabled={supplierLinkBusy !== null && supplierLinkBusy !== 'revoke'}
                  >
                    Revoke link
                  </Button>
                </Popconfirm>
              )}
            </Space>
          </Space>
        </Card>

        <Card
          title={`Lines — revision ${latest.revisionNumber}`}
          size="small"
          extra={
            <Text type="secondary">
              {summary.grandTotal} piece{summary.grandTotal === 1 ? '' : 's'} total
            </Text>
          }
        >
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            {latest.snapshot.garments.map((g) => {
              const gSummary = summaryByGarment.get(g.garmentId);
              const strip = gSummary
                ? Object.entries(gSummary.counts)
                    .map(([size, n]) => `${size} ×${n}`)
                    .join(' · ')
                : '';
              return (
                <div key={g.garmentId}>
                  <div style={{ marginBottom: 8 }}>
                    <Text strong>{g.name}</Text>
                    {g.garmentTypeName && (
                      <Text type="secondary" style={{ marginLeft: 8 }}>
                        {g.garmentTypeName}
                      </Text>
                    )}
                  </div>
                  <Table
                    dataSource={g.lines}
                    columns={LINE_COLUMNS}
                    rowKey="sizingRowId"
                    size="small"
                    pagination={false}
                    locale={{ emptyText: 'No sizing rows in this snapshot' }}
                  />
                  {gSummary && gSummary.total > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {strip} — {gSummary.total} piece{gSummary.total === 1 ? '' : 's'}
                      </Text>
                    </div>
                  )}
                </div>
              );
            })}
          </Space>
        </Card>

        {(latest.snapshot.assets ?? []).length > 0 && (
          <Card title="Design files" size="small">
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              {latest.snapshot.assets!.map((asset, i) => {
                // Signed here by the GET route (the stored snapshot only ever
                // keeps the storageKey) — see signPoAssets in src/lib/signed-urls.ts.
                const signed = asset as PoSnapshotAsset & { downloadUrl?: string | null };
                const link = signed.downloadUrl ?? signed.url;
                return (
                  <div key={`${asset.name}-${i}`}>
                    <Space size={6} wrap>
                      <Tag color={ASSET_KIND_COLOR[asset.kind]} style={{ marginInlineEnd: 0 }}>
                        {ASSET_KIND_LABEL[asset.kind]}
                      </Tag>
                      {link ? (
                        <a href={link} target="_blank" rel="noopener noreferrer">
                          <Space size={4}>
                            {asset.storageKey ? <PaperClipOutlined /> : <LinkOutlined />}
                            {asset.name}
                          </Space>
                        </a>
                      ) : (
                        <Text strong>{asset.name}</Text>
                      )}
                      {asset.garmentName && <Text type="secondary">({asset.garmentName})</Text>}
                      {asset.usage && <Text type="secondary">for {asset.usage}</Text>}
                    </Space>
                    {asset.notes && (
                      <div>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {asset.notes}
                        </Text>
                      </div>
                    )}
                  </div>
                );
              })}
            </Space>
          </Card>
        )}

        <Card title="Revision history" size="small">
          <Timeline
            items={detail.revisions.map((r) => ({
              key: r.id,
              children: (
                <Space size={8} wrap>
                  <Text strong>Revision {r.revisionNumber}</Text>
                  <Text type="secondary">— {r.reason ?? 'Original'} —</Text>
                  <Text type="secondary">{formatDate(r.createdAt)}</Text>
                  <a
                    href={`/api/admin/purchase-orders/${poId}/pdf?rev=${r.revisionNumber}`}
                    aria-label={`PDF for revision ${r.revisionNumber}`}
                  >
                    PDF
                  </a>
                  <a
                    href={`/api/admin/purchase-orders/${poId}/xlsx?rev=${r.revisionNumber}`}
                    aria-label={`XLSX for revision ${r.revisionNumber}`}
                  >
                    XLSX
                  </a>
                </Space>
              ),
            }))}
          />
        </Card>

        <Card title="Shipments" size="small">
          {detail.shipments.length > 0 ? (
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              {detail.shipments.map((s) => (
                <Space key={s.id} size={12}>
                  <Text strong>{s.nickname ?? s.trackingNumber ?? 'Shipment'}</Text>
                  {s.carrier && <Text type="secondary">{s.carrier}</Text>}
                  <ShipmentStatusBadge status={s.status} />
                </Space>
              ))}
            </Space>
          ) : (
            <Text type="secondary">
              No shipments attached yet. Shipment management arrives with the Shipments page.
            </Text>
          )}
        </Card>
      </Space>

      <Modal
        title="Issue revision"
        open={revisionModalOpen}
        onOk={issueRevision}
        onCancel={() => setRevisionModalOpen(false)}
        confirmLoading={issuingRevision}
        okText="Issue revision"
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          Re-snapshots this purchase order from the live order as revision{' '}
          {latest.revisionNumber + 1}. Send the amended PDF to the supplier afterwards.
        </Text>
        <Input.TextArea
          rows={3}
          maxLength={500}
          placeholder="Why is this revision being issued? (required)"
          value={revisionReason}
          onChange={(e) => setRevisionReason(e.target.value)}
        />
      </Modal>
    </div>
  );
}
