'use client';

/**
 * Per-PO page on the password portal: everything the factory needs for ONE
 * purchase order (garments, options, sizing, images, size charts, design/font
 * files — rendered by the shared SupplierPoContent so this page and the legacy
 * /s/[token] surface cannot drift), plus the named-person actions: status
 * moves, the expected-ship-date editor (locked once shipped), the activity
 * feed, and PDF/XLSX export.
 *
 * Layout (David, 2026-08-06): two columns on wide screens — LEFT the static
 * content (summary, order contents, files), RIGHT the activity feed/chat
 * scrolling with the page. Stacks to one column on narrow screens.
 *
 * The page owns the production-files data and hands it to BOTH lenses: the
 * structured Files card (category/version) and the chronological activity
 * feed (comments + uploads + status changes merged into one stream).
 *
 * Auth: the supplier cookie, enforced by GET /api/supplier/[code]/po/[num].
 * A 401 shows the same login card as the portal home; only AFTER a successful
 * sign-in does an unknown number reveal itself as "not found".
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { App, Button, Card, DatePicker, Space, Spin, Tag, Typography } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import {
  ArrowLeftOutlined,
  FileExcelOutlined,
  FilePdfOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import { ApiError, getJson, postJson } from '@/lib/api-fetch';
import { formatDate } from '@/lib/format';
import { poStatusMeta } from '@/lib/status';
import type { SupplierAllowedStatus } from '@/server/supplier-portal/contract';
import type { SupplierPortalViewDto } from '@/server/supplier-portal/service';
import { CustomerPageShell } from '@/components/customer/CustomerPageShell';
import { CARD_STYLE, CARD_BODY_STYLES, FIELD_LABEL_STYLE } from '@/components/customer/customerStyles';
import { SupplierLoginCard } from '@/components/supplier/SupplierLoginCard';
import { SupplierPoContent } from '@/components/supplier/SupplierPoContent';
import { SupplierPoFiles, type PoFileItem } from '@/components/supplier/SupplierPoFiles';
import { SupplierActivityFeed } from '@/components/supplier/SupplierActivityFeed';
import { isShipDateLocked, type SupplierComment } from '@/components/supplier/po-view-helpers';

const { Text } = Typography;

type Phase = 'loading' | 'login' | 'ready' | 'notfound' | 'error';

/** The DTO as it arrives over JSON — comment timestamps serialize to strings. */
type PortalPoView = Omit<SupplierPortalViewDto, 'comments'> & { comments: SupplierComment[] };

/**
 * Left column static, right column the feed, single column under 1080px.
 * A style tag because inline styles cannot express the media query.
 */
const COLUMNS_CSS = `
.supplier-po-columns { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0 24px; align-items: start; }
@media (min-width: 1080px) {
  .supplier-po-columns { grid-template-columns: minmax(0, 1fr) minmax(320px, 420px); }
}
`;

export function SupplierPoDetailView({ code, poNumber }: { code: string; poNumber: string }) {
  const { message } = App.useApp();
  const [phase, setPhase] = useState<Phase>('loading');
  const [view, setView] = useState<PortalPoView | null>(null);
  const [files, setFiles] = useState<PoFileItem[] | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState<SupplierAllowedStatus | null>(null);
  const [shipDate, setShipDate] = useState<Dayjs | null>(null);
  const [savingShipDate, setSavingShipDate] = useState(false);

  const apiBase = `/api/supplier/${encodeURIComponent(code)}/po/${encodeURIComponent(poNumber)}`;

  const load = useCallback(async () => {
    try {
      const data = await getJson<{ view: PortalPoView; name: string }>(
        apiBase,
        'Failed to load purchase order',
      );
      setView(data.view);
      setShipDate(data.view.expectedShipDate ? dayjs(data.view.expectedShipDate) : null);
      setPhase('ready');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setPhase('login');
      else if (err instanceof ApiError && err.status === 404) setPhase('notfound');
      else setPhase('error');
    }
  }, [apiBase]);

  const loadFiles = useCallback(async () => {
    try {
      const data = await getJson<{ items: PoFileItem[] }>(`${apiBase}/files`, 'Failed to load files');
      setFiles(data.items);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setPhase('login');
      else setFiles([]);
    }
  }, [apiBase]);

  useEffect(() => {
    void load();
    void loadFiles();
  }, [load, loadFiles]);

  async function applyStatus(next: SupplierAllowedStatus) {
    setUpdatingStatus(next);
    try {
      const { results } = await postJson<{
        results: { poNumber: string; ok: boolean; error?: string }[];
      }>(
        `/api/supplier/${encodeURIComponent(code)}/status`,
        { poNumbers: [poNumber], status: next },
        'Failed to update status',
      );
      const result = results[0];
      if (result?.ok) {
        message.success(`Status updated to ${poStatusMeta(next).label}`);
        await load();
      } else {
        message.error(result?.error ?? 'Failed to update status');
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setPhase('login');
      else message.error(err instanceof Error ? err.message : 'Failed to update status');
    } finally {
      setUpdatingStatus(null);
    }
  }

  async function saveShipDate() {
    if (!shipDate) return;
    setSavingShipDate(true);
    try {
      await postJson(
        `/api/supplier/${encodeURIComponent(code)}/ship-date`,
        { poNumber, expectedShipDate: shipDate.format('YYYY-MM-DD') },
        'Failed to save ship date',
      );
      message.success('Expected ship date saved');
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setPhase('login');
      // A 409 carries the server's own explanation (locked after shipping).
      else message.error(err instanceof Error ? err.message : 'Failed to save ship date');
    } finally {
      setSavingShipDate(false);
    }
  }

  if (phase === 'loading') {
    return (
      <CustomerPageShell label="Supplier Portal" title={poNumber}>
        <div style={{ textAlign: 'center', padding: 60 }}>
          <Spin size="large" />
        </div>
      </CustomerPageShell>
    );
  }

  if (phase === 'login') {
    return (
      <CustomerPageShell label="Supplier Portal" title={poNumber} subtitle="Sign in to view this purchase order">
        <SupplierLoginCard
          code={code}
          onSuccess={() => {
            setPhase('loading');
            void load();
            void loadFiles();
          }}
        />
      </CustomerPageShell>
    );
  }

  if (phase === 'notfound' || phase === 'error' || !view) {
    return (
      <CustomerPageShell label="Supplier Portal" title={poNumber}>
        <Card style={CARD_STYLE} styles={CARD_BODY_STYLES}>
          <Text style={{ color: 'rgba(255,255,255,0.75)' }}>
            {phase === 'notfound'
              ? 'This purchase order was not found. It may not have been sent yet, or the link may be wrong.'
              : 'Something went wrong loading this purchase order. Please try again.'}
          </Text>
        </Card>
      </CustomerPageShell>
    );
  }

  const currentMeta = poStatusMeta(view.status);
  const shipDateLocked = isShipDateLocked(view.status);

  return (
    <CustomerPageShell
      label="Supplier Portal"
      title={view.poNumber}
      subtitle={`Revision ${view.revisionNumber} — ${view.supplier.name}`}
      maxWidth={1320}
    >
      <style>{COLUMNS_CSS}</style>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <Link href={`/supplier/${encodeURIComponent(code)}`} style={{ color: 'rgba(255,255,255,0.65)' }}>
          <ArrowLeftOutlined /> All purchase orders
        </Link>
        <Space>
          <Button size="small" icon={<FilePdfOutlined />} href={`${apiBase}/pdf`}>
            Export PDF
          </Button>
          <Button size="small" icon={<FileExcelOutlined />} href={`${apiBase}/xlsx`}>
            Export XLSX
          </Button>
        </Space>
      </div>

      <div className="supplier-po-columns">
        {/* LEFT — the static content: summary, order contents, files. */}
        <div style={{ minWidth: 0 }}>
          <Card style={CARD_STYLE} styles={CARD_BODY_STYLES}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16 }}>
              <div>
                <Text style={FIELD_LABEL_STYLE}>Status</Text>
                <Tag color={currentMeta.tag} style={{ marginTop: 4 }}>
                  {currentMeta.label}
                </Tag>
              </div>
              <div>
                <Text style={FIELD_LABEL_STYLE}>Our order</Text>
                <Text style={{ color: 'rgba(255,255,255,0.9)' }}>{view.snapshot.orderNumber}</Text>
              </div>
              {view.colorBookName && (
                <div>
                  <Text style={FIELD_LABEL_STYLE}>Colour book</Text>
                  <Text style={{ color: 'rgba(255,255,255,0.9)' }}>{view.colorBookName}</Text>
                </div>
              )}
              {view.actualShipDate && (
                <div>
                  <Text style={FIELD_LABEL_STYLE}>Shipped</Text>
                  <Text style={{ color: 'rgba(255,255,255,0.9)' }}>{formatDate(view.actualShipDate)}</Text>
                </div>
              )}
              {view.sentAt && (
                <div>
                  <Text style={FIELD_LABEL_STYLE}>First sent</Text>
                  <Text style={{ color: 'rgba(255,255,255,0.9)' }}>{formatDate(view.sentAt)}</Text>
                </div>
              )}
            </div>

            {/* Expected ship date — the supplier's own commitment. Locked once the
                PO has shipped (David: "can not affect anything after SHIPPED"). */}
            <div style={{ marginTop: 20 }}>
              <Text style={FIELD_LABEL_STYLE}>Expected ship date</Text>
              {shipDateLocked ? (
                <Text style={{ color: 'rgba(255,255,255,0.9)' }}>
                  {view.expectedShipDate ? formatDate(view.expectedShipDate) : '—'}
                </Text>
              ) : (
                <Space wrap>
                  <DatePicker
                    value={shipDate}
                    onChange={(value) => setShipDate(value)}
                    format="DD MMM YYYY"
                    allowClear={false}
                    disabled={savingShipDate}
                  />
                  <Button
                    icon={<SaveOutlined />}
                    loading={savingShipDate}
                    disabled={
                      !shipDate ||
                      shipDate.format('YYYY-MM-DD') === (view.expectedShipDate ?? '')
                    }
                    onClick={() => void saveShipDate()}
                  >
                    Save
                  </Button>
                </Space>
              )}
            </div>

            {view.notes && (
              <div style={{ marginTop: 16 }}>
                <Text style={FIELD_LABEL_STYLE}>Notes from BeastMode</Text>
                <Text style={{ color: 'rgba(255,255,255,0.9)', whiteSpace: 'pre-wrap' }}>{view.notes}</Text>
              </div>
            )}

            {view.allowedNextStatuses.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <Text style={{ ...FIELD_LABEL_STYLE, marginBottom: 8 }}>Update status</Text>
                <Space wrap>
                  {view.allowedNextStatuses.map((status) => (
                    <Button
                      key={status}
                      loading={updatingStatus === status}
                      disabled={updatingStatus !== null}
                      onClick={() => void applyStatus(status)}
                    >
                      {poStatusMeta(status).label}
                    </Button>
                  ))}
                </Space>
              </div>
            )}
          </Card>

          <SupplierPoContent snapshot={view.snapshot} />

          <SupplierPoFiles code={code} poNumber={poNumber} items={files} onUploaded={loadFiles} />
        </div>

        {/* RIGHT — the chronological lens: comments, uploads and status
            changes in one stream, scrolling with the page. */}
        <div style={{ minWidth: 0 }}>
          <SupplierActivityFeed
            comments={view.comments}
            statusHistory={view.statusHistory}
            files={files}
            supplierName={view.supplier.name}
            onSendComment={async (body) => {
              await postJson(
                `/api/supplier/${encodeURIComponent(code)}/comment`,
                { poNumber, body },
                'Failed to send comment',
              );
              await load();
            }}
            onSendFileComment={async (fileId, body) => {
              await postJson(`${apiBase}/files/${fileId}`, { body }, 'Failed to send comment');
              await loadFiles();
            }}
          />
        </div>
      </div>
    </CustomerPageShell>
  );
}
