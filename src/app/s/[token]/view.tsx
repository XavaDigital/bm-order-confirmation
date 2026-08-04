'use client';

/**
 * The supplier portal (SUPPLIER_PORTAL_PLAN.md): a token-gated, no-session
 * view of ONE purchase order. A supplier can see exactly what was on the PDF
 * they were emailed, push the status forward through the shop-floor states,
 * and leave a comment staff see immediately in the order's Notes tab.
 *
 * Deliberately read-only beyond those two actions — garments/sizing render
 * from the same PoSnapshot the PDF renders from, never the live order (which
 * could have moved on since this revision was sent).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { App, Button, Card, Empty, Input, Space, Table, Tag, Typography } from 'antd';
import type { ColumnType } from 'antd/es/table';
import { LinkOutlined, PaperClipOutlined, SendOutlined } from '@ant-design/icons';
import { postJson } from '@/lib/api-fetch';
import { formatDate } from '@/lib/format';
import { PO_STATUS } from '@/lib/status';
import { ASSET_KIND_COLOR, ASSET_KIND_LABEL } from '@/lib/asset-kind';
import type { PoSnapshot, PoSnapshotAsset, PoSnapshotLine } from '@/db/schema';
import type { PoStatus } from '@/server/purchase-orders/contract';
import type { SupplierAllowedStatus } from '@/server/supplier-portal/contract';
import { CustomerPageShell } from '@/components/customer/CustomerPageShell';
import { CARD_STYLE, CARD_BODY_STYLES } from '@/components/customer/customerStyles';

const { Text } = Typography;

export interface SupplierPortalComment {
  id: string;
  body: string;
  authorKind: 'staff' | 'email_flow' | 'system' | 'supplier';
  authorLabel: string | null;
  createdAt: string;
}

export interface SupplierPortalViewProps {
  token: string;
  view: {
    poNumber: string;
    status: string;
    allowedNextStatuses: SupplierAllowedStatus[];
    deadlineDate: string | null;
    expectedShipDate: string | null;
    actualShipDate: string | null;
    sentAt: string | null;
    notes: string | null;
    supplier: { name: string; contactPerson: string | null; email: string | null; phone: string | null };
    revisionNumber: number;
    snapshot: PoSnapshot;
    comments: SupplierPortalComment[];
  };
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

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function SupplierPortalView({ token, view }: SupplierPortalViewProps) {
  const router = useRouter();
  const { message } = App.useApp();
  const [updatingStatus, setUpdatingStatus] = useState<SupplierAllowedStatus | null>(null);
  const [comment, setComment] = useState('');
  const [sendingComment, setSendingComment] = useState(false);

  async function applyStatus(next: SupplierAllowedStatus) {
    setUpdatingStatus(next);
    try {
      await postJson('/api/s/status', { token, status: next }, 'Failed to update status');
      message.success(`Status updated to ${PO_STATUS[next].label}`);
      router.refresh();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to update status');
    } finally {
      setUpdatingStatus(null);
    }
  }

  async function sendComment() {
    const body = comment.trim();
    if (!body) return;
    setSendingComment(true);
    try {
      await postJson('/api/s/comment', { token, body }, 'Failed to send comment');
      setComment('');
      router.refresh();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to send comment');
    } finally {
      setSendingComment(false);
    }
  }

  const currentMeta = PO_STATUS[view.status as PoStatus] ?? {
    label: view.status,
    tag: 'default',
  };

  return (
    <CustomerPageShell
      label="Supplier Portal"
      title={view.poNumber}
      subtitle={`Revision ${view.revisionNumber} — ${view.supplier.name}`}
    >
      <Card style={CARD_STYLE} styles={CARD_BODY_STYLES}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16 }}>
          <div>
            <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, display: 'block' }}>Status</Text>
            <Tag color={currentMeta.tag} style={{ marginTop: 4 }}>
              {currentMeta.label}
            </Tag>
          </div>
          <div>
            <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, display: 'block' }}>Deadline</Text>
            <Text style={{ color: 'rgba(255,255,255,0.9)' }}>
              {view.deadlineDate ? formatDate(view.deadlineDate) : '—'}
            </Text>
          </div>
          <div>
            <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, display: 'block' }}>
              Expected ship
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.9)' }}>
              {view.expectedShipDate ? formatDate(view.expectedShipDate) : '—'}
            </Text>
          </div>
          {view.sentAt && (
            <div>
              <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, display: 'block' }}>
                First sent
              </Text>
              <Text style={{ color: 'rgba(255,255,255,0.9)' }}>{formatDate(view.sentAt)}</Text>
            </div>
          )}
        </div>

        {view.notes && (
          <div style={{ marginTop: 16 }}>
            <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, display: 'block' }}>
              Notes from BeastMode
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.9)', whiteSpace: 'pre-wrap' }}>{view.notes}</Text>
          </div>
        )}

        {view.allowedNextStatuses.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, display: 'block', marginBottom: 8 }}>
              Update status
            </Text>
            <Space wrap>
              {view.allowedNextStatuses.map((s) => (
                <Button
                  key={s}
                  loading={updatingStatus === s}
                  disabled={updatingStatus !== null}
                  onClick={() => applyStatus(s)}
                >
                  {PO_STATUS[s].label}
                </Button>
              ))}
            </Space>
          </div>
        )}
      </Card>

      <Card title="Order contents" style={CARD_STYLE} styles={CARD_BODY_STYLES}>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {view.snapshot.garments.map((g) => (
            <div key={g.garmentId}>
              <div style={{ marginBottom: 8 }}>
                <Text strong style={{ color: 'rgba(255,255,255,0.9)' }}>
                  {g.name}
                </Text>
                {g.garmentTypeName && (
                  <Text style={{ color: 'rgba(255,255,255,0.45)', marginLeft: 8 }}>
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
                locale={{ emptyText: 'No sizing rows in this revision' }}
              />
            </div>
          ))}
        </Space>
      </Card>

      {(view.snapshot.assets ?? []).length > 0 && (
        <Card title="Design files" style={CARD_STYLE} styles={CARD_BODY_STYLES}>
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {view.snapshot.assets!.map((asset, i) => {
              const signed = asset as PoSnapshotAsset & { downloadUrl?: string | null };
              const link = signed.downloadUrl ?? signed.url;
              return (
                <div key={`${asset.name}-${i}`}>
                  <Space size={6} wrap>
                    <Tag color={ASSET_KIND_COLOR[asset.kind]} style={{ marginInlineEnd: 0 }}>
                      {ASSET_KIND_LABEL[asset.kind]}
                    </Tag>
                    {link ? (
                      <a
                        href={link}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: '#fff' }}
                      >
                        <Space size={4}>
                          {asset.storageKey ? <PaperClipOutlined /> : <LinkOutlined />}
                          {asset.name}
                        </Space>
                      </a>
                    ) : (
                      <Text style={{ color: 'rgba(255,255,255,0.9)' }}>{asset.name}</Text>
                    )}
                    {asset.garmentName && (
                      <Text style={{ color: 'rgba(255,255,255,0.45)' }}>({asset.garmentName})</Text>
                    )}
                    {asset.usage && (
                      <Text style={{ color: 'rgba(255,255,255,0.45)' }}>for {asset.usage}</Text>
                    )}
                  </Space>
                  {asset.notes && (
                    <div>
                      <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>
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

      <Card title="Comments" style={CARD_STYLE} styles={CARD_BODY_STYLES}>
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
          {view.comments.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <Text style={{ color: 'rgba(255,255,255,0.45)' }}>No comments yet</Text>
              }
            />
          ) : (
            view.comments.map((c) => (
              <div key={c.id}>
                <Space size={6} wrap style={{ marginBottom: 2 }}>
                  <Text strong style={{ color: 'rgba(255,255,255,0.9)', fontSize: 13 }}>
                    {c.authorKind === 'supplier' ? view.supplier.name : (c.authorLabel ?? 'BeastMode')}
                  </Text>
                  <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>
                    {formatWhen(c.createdAt)}
                  </Text>
                </Space>
                <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13, whiteSpace: 'pre-wrap', display: 'block' }}>
                  {c.body}
                </Text>
              </div>
            ))
          )}

          <div>
            <Input.TextArea
              rows={3}
              maxLength={2000}
              placeholder="Add a comment…"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              disabled={sendingComment}
            />
            <Button
              type="primary"
              size="small"
              icon={<SendOutlined />}
              loading={sendingComment}
              disabled={!comment.trim()}
              onClick={sendComment}
              style={{ marginTop: 8 }}
            >
              Send
            </Button>
          </div>
        </Space>
      </Card>
    </CustomerPageShell>
  );
}
