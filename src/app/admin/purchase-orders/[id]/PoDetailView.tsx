'use client';

/**
 * Purchase-order detail (PO_PLAN): header actions (approve / send / PDF /
 * status machine), variance banner + revision issuing, editable ship dates and
 * notes (the customer deadline is display-only — imported from the order),
 * the always-on supplier portal link + password snippet, the supplier-shared
 * comment thread and the order's team notes, the latest-revision line tables,
 * revision + audit history, and a shipments placeholder.
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
  CheckOutlined,
  CopyOutlined,
  DownOutlined,
  DownloadOutlined,
  ExportOutlined,
  FileExcelOutlined,
  LinkOutlined,
  MailOutlined,
  PaperClipOutlined,
  SendOutlined,
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
import type { PoSnapshot, PoSnapshotAsset, PoSnapshotGarment, PoSnapshotLine } from '@/db/schema';
import { PO_STATUS, poStatusMeta } from '@/lib/status';
import { ASSET_KIND_COLOR, ASSET_KIND_LABEL } from '@/lib/asset-kind';
import { formatDate } from '@/lib/format';
import { getJson, postJson, patchJson } from '@/lib/api-fetch';

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

/** One audit row of the PO's who/when record (listPoHistory, newest first). */
interface PoHistoryEntry {
  id: string;
  eventType: string;
  actorEmail: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

/** Plain labels for the PO history card — anything else renders its raw type. */
const HISTORY_EVENT_LABEL: Record<string, string> = {
  'po.status_changed': 'Status changed',
  'po.ship_date_changed': 'Ship date changed',
  'po.supplier_updated': 'Supplier update',
  'po.sent': 'Sent to supplier',
  'po.created': 'Created',
  'po.updated': 'Details updated',
};

/** A note/comment row from the parent order's notes API (subset we render). */
interface PoOrderNote {
  id: string;
  body: string;
  authorKind: 'staff' | 'email_flow' | 'system' | 'supplier';
  authorName: string | null;
  authorEmail: string | null;
  authorLabel: string | null;
  visibility: 'internal' | 'shared';
  deleted: boolean;
  createdAt: string;
}

function noteAuthor(note: PoOrderNote): string {
  return note.authorName ?? note.authorEmail ?? note.authorLabel ?? 'Unknown';
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
  order: {
    id: string;
    orderNumber: string;
    customerName: string;
    status: string;
    /** The customer deadline — served live from the order so it can't go stale. */
    deadlineDate: string | null;
  };
  revisions: PoRevision[];
  shipments: PoShipment[];
  /** Legacy emailed-token link info (the token flow is gone; view-only). */
  supplierLink: { active: boolean; lastViewedAt: string | null };
  /** The pretty always-on portal URL (/supplier/{CODE}/...). */
  portalUrl: string;
  history: PoHistoryEntry[];
}

interface ProductionSummary {
  purchaseOrders: Array<{
    id: string;
    variance: PoVariance;
    varianceCounts: PoVarianceCounts;
  }>;
}

const dash = <Text type="secondary">—</Text>;

/**
 * Line-table columns for one snapshot garment: the fixed columns plus one per
 * user-defined sizing column captured in the snapshot (values live in each
 * line's `customValues`, keyed by label). Quantity only appears when some line
 * carries one — pre-0025 revisions have none and a column of 1s is noise.
 */
function buildLineColumns(garment: PoSnapshotGarment): ColumnType<PoSnapshotLine>[] {
  const columns: ColumnType<PoSnapshotLine>[] = [
    {
      title: 'Size',
      dataIndex: 'size',
      width: 120,
      render: (v: string | null) => v ?? dash,
    },
    {
      title: 'Player',
      dataIndex: 'playerName',
      render: (v: string | null) => v ?? dash,
    },
    {
      title: 'Number',
      dataIndex: 'playerNumber',
      width: 110,
      render: (v: string | null) => v ?? dash,
    },
  ];

  for (const col of garment.sizingColumns ?? []) {
    columns.push({
      title: col.label,
      key: `custom-${col.label}`,
      render: (_: unknown, line: PoSnapshotLine) => line.customValues?.[col.label] ?? dash,
    });
  }

  if ((garment.lines ?? []).some((line) => line.quantity !== undefined)) {
    columns.push({
      title: 'Qty',
      dataIndex: 'quantity',
      width: 70,
      render: (v: number | undefined) => v ?? 1,
    });
  }

  columns.push({
    title: 'Notes',
    dataIndex: 'notes',
    render: (v: string | null) => v ?? dash,
  });

  return columns;
}

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

  // Editable summary fields (the customer deadline is display-only — it is
  // imported from the order server-side and never sent from here).
  const [expectedShip, setExpectedShip] = useState<Dayjs | null>(null);
  const [actualShip, setActualShip] = useState<Dayjs | null>(null);
  const [notes, setNotes] = useState('');
  const [savingSummary, setSavingSummary] = useState(false);

  // The supplier's portal password (from the supplier record): undefined =
  // still loading, null = no password set (portal closed).
  const [portalPassword, setPortalPassword] = useState<string | null | undefined>(undefined);

  // The parent order's threads: supplier-shared comments + team order notes.
  const [comments, setComments] = useState<PoOrderNote[]>([]);
  const [orderNotes, setOrderNotes] = useState<PoOrderNote[]>([]);
  const [commentDraft, setCommentDraft] = useState('');
  const [postingComment, setPostingComment] = useState(false);

  const loadThreads = useCallback(
    async (orderId: string) => {
      // Best-effort: the PO page still works if the notes API fails.
      try {
        const [commentRows, noteRows] = await Promise.all([
          getJson<PoOrderNote[]>(
            `/api/admin/orders/${orderId}/notes`,
            'Failed to load comments',
          ),
          getJson<PoOrderNote[]>(
            `/api/admin/orders/${orderId}/notes?kind=note`,
            'Failed to load order notes',
          ),
        ]);
        // The supplier conversation is the SHARED slice of the order thread —
        // internal chatter stays on the order page.
        setComments(commentRows.filter((n) => n.visibility === 'shared' && !n.deleted));
        setOrderNotes(noteRows.filter((n) => !n.deleted));
      } catch {
        // leave whatever was last loaded
      }
    },
    [],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await getJson<PoDetail>(
        `/api/admin/purchase-orders/${poId}`,
        'Failed to load purchase order',
      );
      setDetail(d);
      setExpectedShip(d.expectedShipDate ? dayjs(d.expectedShipDate) : null);
      setActualShip(d.actualShipDate ? dayjs(d.actualShipDate) : null);
      setNotes(d.notes ?? '');
      // The portal password lives on the supplier record, not the PO read.
      try {
        const supplier = await getJson<{ portalPassword: string | null }>(
          `/api/admin/suppliers/${d.supplier.id}`,
          'Failed to load supplier',
        );
        setPortalPassword(supplier.portalPassword);
      } catch {
        setPortalPassword(undefined);
      }
      await loadThreads(d.orderId);
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
  }, [poId, message, loadThreads]);

  useEffect(() => {
    load();
  }, [load]);

  async function sendToSupplier() {
    setSending(true);
    try {
      const res = await postJson<{
        ok: true;
        poNumber: string;
        to: string;
        attachmentSummary: { images: number; fonts: number; sizeCharts: number; sizeReduced: boolean };
      }>(`/api/admin/purchase-orders/${poId}/send`, {}, 'Failed to send purchase order');
      const { images, fonts, sizeCharts, sizeReduced } = res.attachmentSummary;
      const parts = ['PDF', 'spreadsheet'];
      if (images > 0) parts.push(`${images} image${images === 1 ? '' : 's'}`);
      if (fonts > 0) parts.push(`${fonts} font/design file${fonts === 1 ? '' : 's'}`);
      if (sizeCharts > 0) parts.push(`${sizeCharts} size chart${sizeCharts === 1 ? '' : 's'}`);
      message.success(`Purchase order emailed to ${res.to} (${parts.join(', ')})`);
      if (sizeReduced) {
        message.warning('Images were too large to attach at full resolution — reduced-size copies were sent instead.');
      }
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
          // No deadlineDate — it mirrors the order's customer deadline and is
          // not editable per PO.
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

  /** Link + password together, ready to paste into an email (ShareLinkPanel's pattern). */
  function portalEmailSnippet(url: string, password: string): string {
    return `View and update this purchase order here:\n${url}\n\nPortal password: ${password}`;
  }

  async function copyPortalSnippet() {
    if (!detail || !portalPassword) return;
    try {
      await navigator.clipboard.writeText(portalEmailSnippet(detail.portalUrl, portalPassword));
      message.success('Link and password copied to clipboard');
    } catch {
      message.error('Copy failed — please copy manually');
    }
  }

  async function postComment() {
    if (!detail || !commentDraft.trim()) return;
    setPostingComment(true);
    try {
      await postJson(
        `/api/admin/orders/${detail.orderId}/notes`,
        { body: commentDraft.trim(), visibility: 'shared' },
        'Failed to post the comment',
      );
      setCommentDraft('');
      await loadThreads(detail.orderId);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to post the comment');
    } finally {
      setPostingComment(false);
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
  const isDraft = detail.status === 'draft';
  // Mirrors sendPurchaseOrder's guards: a draft must be approved first, and a
  // received/completed/cancelled PO has nothing left to send.
  const canSend = !['draft', 'received', 'completed', 'cancelled'].includes(detail.status);

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
            {isDraft && (
              <Button
                type="primary"
                icon={<CheckOutlined />}
                onClick={() => applyStatus('approved')}
              >
                Approve
              </Button>
            )}
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
                    : isDraft
                      ? 'Approve the purchase order before sending it'
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
                    Customer deadline
                  </Text>
                  <Tooltip title="Imported from the customer order automatically; hidden from the supplier">
                    <Text>
                      {detail.order.deadlineDate ? (
                        formatDate(detail.order.deadlineDate)
                      ) : (
                        <Text type="secondary">None set</Text>
                      )}
                    </Text>
                  </Tooltip>
                </div>
                <div>
                  <Text strong style={{ display: 'block', marginBottom: 4 }}>
                    Required ship date
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
              The supplier&apos;s permanent link to this purchase order — view the latest
              revision, push the status forward, and leave a comment. Guarded by the
              supplier&apos;s portal password.
            </Text>

            {/* Same compact treatment as the customer link (ShareLinkPanel). */}
            <Space wrap size={8}>
              <Text code copyable={{ text: detail.portalUrl }} style={{ wordBreak: 'break-all' }}>
                {detail.portalUrl}
              </Text>
              <Button
                size="small"
                icon={<ExportOutlined />}
                href={detail.portalUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open
              </Button>
            </Space>

            {portalPassword === null && (
              <Alert
                type="warning"
                showIcon
                message="The supplier portal is closed"
                description={
                  <span>
                    {detail.supplier.name} has no portal password, so this link won&apos;t open
                    until an admin sets one on the{' '}
                    <Link href="/admin/suppliers">supplier record</Link>.
                  </span>
                }
              />
            )}

            {/* Link + password together, ready to paste into an email. */}
            {portalPassword && (
              <div
                style={{
                  padding: '10px 14px',
                  background: 'var(--ant-color-fill-tertiary)',
                  border: '1px solid var(--ant-color-border)',
                  borderRadius: 6,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <Text strong>For your email</Text>
                  <Button
                    type="primary"
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={copyPortalSnippet}
                  >
                    Copy link + password
                  </Button>
                </div>
                <Text
                  type="secondary"
                  style={{ fontSize: 12, whiteSpace: 'pre-wrap', display: 'block', wordBreak: 'break-all' }}
                >
                  {portalEmailSnippet(detail.portalUrl, portalPassword)}
                </Text>
              </div>
            )}

            {detail.supplierLink.lastViewedAt && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                Legacy emailed link last opened {formatDate(detail.supplierLink.lastViewedAt)}
              </Text>
            )}
          </Space>
        </Card>

        <Card title="Comments" size="small">
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              The conversation shared with the supplier on their portal — their comments and
              staff replies. Anything posted here is visible to the supplier.
            </Text>
            {comments.length === 0 ? (
              <Text type="secondary">No shared comments yet.</Text>
            ) : (
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                {comments.map((note) => (
                  <div key={note.id}>
                    <Space size={6} wrap>
                      <Text strong style={{ fontSize: 13 }}>
                        {noteAuthor(note)}
                      </Text>
                      {note.authorKind === 'supplier' && (
                        <Tag color="gold" style={{ marginInlineEnd: 0 }}>
                          Supplier
                        </Tag>
                      )}
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {formatDate(note.createdAt)}
                      </Text>
                    </Space>
                    <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{note.body}</div>
                  </div>
                ))}
              </Space>
            )}
            <div>
              <Input.TextArea
                rows={2}
                maxLength={2000}
                value={commentDraft}
                onChange={(e) => setCommentDraft(e.target.value)}
                placeholder="Reply to the supplier…"
                aria-label="New supplier comment"
              />
              <div style={{ marginTop: 6 }}>
                <Button
                  type="primary"
                  size="small"
                  icon={<SendOutlined />}
                  loading={postingComment}
                  disabled={!commentDraft.trim()}
                  onClick={postComment}
                >
                  Post to supplier
                </Button>
              </div>
            </div>
          </Space>
        </Card>

        <Card title="Order notes (from the order)" size="small">
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              The team&apos;s order notes, brought through so production can check every point
              has been dealt with. Add or edit them on the order page.
            </Text>
            {orderNotes.length === 0 ? (
              <Text type="secondary">No order notes.</Text>
            ) : (
              orderNotes.map((note) => (
                <div key={note.id}>
                  <Space size={6} wrap>
                    <Text strong style={{ fontSize: 13 }}>
                      {noteAuthor(note)}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {formatDate(note.createdAt)}
                    </Text>
                  </Space>
                  <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{note.body}</div>
                </div>
              ))
            )}
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
              const fabricPairs = Object.entries(g.selectedFabrics ?? {});
              const optionPairs = Object.entries(g.selectedOptions ?? {});
              const images = g.images ?? [];
              const imageCaptions = images
                .map((img) => img.caption)
                .filter((c): c is string => Boolean(c));
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
                  {(fabricPairs.length > 0 || g.fabrics.length > 0) && (
                    <div style={{ marginBottom: 4 }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        Fabrics:{' '}
                        {fabricPairs.length > 0
                          ? fabricPairs.map(([part, fabric]) => `${part}: ${fabric}`).join(' · ')
                          : g.fabrics.join(', ')}
                      </Text>
                    </div>
                  )}
                  {optionPairs.length > 0 && (
                    <div style={{ marginBottom: 4 }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        Options:{' '}
                        {optionPairs.map(([label, value]) => `${label}: ${value}`).join(' · ')}
                      </Text>
                    </div>
                  )}
                  {(g.sizeCharts ?? []).length > 0 && (
                    <div style={{ marginBottom: 4 }}>
                      <Space size={4} wrap>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          Size charts:
                        </Text>
                        {g.sizeCharts!.map((chart) => (
                          <Tag key={chart.id} style={{ marginInlineEnd: 0 }}>
                            {chart.name}
                          </Tag>
                        ))}
                      </Space>
                    </div>
                  )}
                  {/* The admin read serves raw storage keys for snapshot images
                      (only PO assets are signed on this surface), so list the
                      count and captions rather than dead thumbnails. */}
                  {images.length > 0 && (
                    <div style={{ marginBottom: 4 }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {images.length} mock-up image{images.length === 1 ? '' : 's'} on the
                        supplier PO
                        {imageCaptions.length > 0 ? ` — ${imageCaptions.join(' · ')}` : ''}
                      </Text>
                    </div>
                  )}
                  <Table
                    dataSource={g.lines}
                    columns={buildLineColumns(g)}
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

        <Card title="History" size="small">
          {detail.history.length === 0 ? (
            <Text type="secondary">Nothing recorded yet.</Text>
          ) : (
            <Timeline
              items={detail.history.map((entry) => {
                const from = entry.payload?.from;
                const to = entry.payload?.to;
                const isStatus = entry.eventType === 'po.status_changed';
                return {
                  key: entry.id,
                  children: (
                    <Space size={8} wrap>
                      <Text strong>
                        {HISTORY_EVENT_LABEL[entry.eventType] ?? entry.eventType}
                      </Text>
                      {typeof from === 'string' && typeof to === 'string' && (
                        <Text>
                          {isStatus ? poStatusMeta(from).label : from} →{' '}
                          {isStatus ? poStatusMeta(to).label : to}
                        </Text>
                      )}
                      {entry.actorEmail && (
                        <Text type="secondary">{entry.actorEmail}</Text>
                      )}
                      <Text type="secondary">{formatDate(entry.createdAt)}</Text>
                    </Space>
                  ),
                };
              })}
            />
          )}
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
