'use client';

/**
 * The legacy token-gated supplier link (SUPPLIER_PORTAL_PLAN.md): a no-session
 * view of ONE purchase order — links already in supplier inboxes keep working
 * forever. A supplier can see everything the factory needs (rendered by the
 * shared SupplierPoContent, identical to the password portal's per-PO page so
 * the two surfaces cannot drift), push the status forward through the
 * shop-floor states, and follow the activity feed (comments + status changes;
 * no production files here — that API is password-portal only).
 *
 * Layout mirrors the portal PO page (David, 2026-08-06): static content on
 * the left, the feed on the right, stacking to one column on narrow screens.
 *
 * Deliberately NO ship-date editor here — that action needs a named person,
 * which only the password portal (/supplier/[code]) captures. And no deadline
 * anywhere: the customer deadline must never reach the supplier.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { App, Button, Card, Space, Tag, Typography } from 'antd';
import { postJson } from '@/lib/api-fetch';
import { formatDate } from '@/lib/format';
import { poStatusMeta } from '@/lib/status';
import type { PoSnapshot } from '@/db/schema';
import type { SupplierAllowedStatus } from '@/server/supplier-portal/contract';
import { CustomerPageShell } from '@/components/customer/CustomerPageShell';
import { CARD_STYLE, CARD_BODY_STYLES, FIELD_LABEL_STYLE } from '@/components/customer/customerStyles';
import { SupplierPoContent } from '@/components/supplier/SupplierPoContent';
import { SupplierActivityFeed } from '@/components/supplier/SupplierActivityFeed';
import type { SupplierComment, SupplierStatusChange } from '@/components/supplier/po-view-helpers';

const { Text } = Typography;

export type SupplierPortalComment = SupplierComment;

/** Same breakpoint/columns as the portal PO page — keep the surfaces aligned. */
const COLUMNS_CSS = `
.supplier-po-columns { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0 24px; align-items: start; }
@media (min-width: 1080px) {
  .supplier-po-columns { grid-template-columns: minmax(0, 1fr) minmax(320px, 420px); }
}
`;

export interface SupplierPortalViewProps {
  token: string;
  view: {
    poNumber: string;
    status: string;
    allowedNextStatuses: SupplierAllowedStatus[];
    expectedShipDate: string | null;
    actualShipDate: string | null;
    sentAt: string | null;
    notes: string | null;
    /** The colour book the job is matched against (David, 2026-08-05). */
    colorBookName: string | null;
    supplier: { name: string; contactPerson: string | null; email: string | null; phone: string | null };
    revisionNumber: number;
    snapshot: PoSnapshot;
    comments: SupplierPortalComment[];
    statusHistory: SupplierStatusChange[];
  };
}

export function SupplierPortalView({ token, view }: SupplierPortalViewProps) {
  const router = useRouter();
  const { message } = App.useApp();
  const [updatingStatus, setUpdatingStatus] = useState<SupplierAllowedStatus | null>(null);

  async function applyStatus(next: SupplierAllowedStatus) {
    setUpdatingStatus(next);
    try {
      await postJson('/api/s/status', { token, status: next }, 'Failed to update status');
      message.success(`Status updated to ${poStatusMeta(next).label}`);
      router.refresh();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to update status');
    } finally {
      setUpdatingStatus(null);
    }
  }

  const currentMeta = poStatusMeta(view.status);

  return (
    <CustomerPageShell
      label="Supplier Portal"
      title={view.poNumber}
      subtitle={`Revision ${view.revisionNumber} — ${view.supplier.name}`}
      maxWidth={1320}
    >
      <style>{COLUMNS_CSS}</style>
      <div className="supplier-po-columns">
        {/* LEFT — the static content: summary and the order contents. */}
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
                <Text style={FIELD_LABEL_STYLE}>Expected ship</Text>
                <Text style={{ color: 'rgba(255,255,255,0.9)' }}>
                  {view.expectedShipDate ? formatDate(view.expectedShipDate) : '—'}
                </Text>
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
                  {view.allowedNextStatuses.map((s) => (
                    <Button
                      key={s}
                      loading={updatingStatus === s}
                      disabled={updatingStatus !== null}
                      onClick={() => void applyStatus(s)}
                    >
                      {poStatusMeta(s).label}
                    </Button>
                  ))}
                </Space>
              </div>
            )}
          </Card>

          <SupplierPoContent snapshot={view.snapshot} />
        </div>

        {/* RIGHT — comments + status changes merged chronologically. This
            surface has no files API, so the feed simply gets none. */}
        <div style={{ minWidth: 0 }}>
          <SupplierActivityFeed
            comments={view.comments}
            statusHistory={view.statusHistory}
            supplierName={view.supplier.name}
            onSendComment={async (body) => {
              await postJson('/api/s/comment', { token, body }, 'Failed to send comment');
              router.refresh();
            }}
          />
        </div>
      </div>
    </CustomerPageShell>
  );
}
