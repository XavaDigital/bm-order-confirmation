'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Tabs,
  Form,
  Button,
  Space,
  Typography,
  Card,
  App,
  Popconfirm,
  Breadcrumb,
  Alert,
  Tooltip,
  Input,
} from 'antd';
import {
  ArrowLeftOutlined,
  BgColorsOutlined,
  DeleteOutlined,
  SaveOutlined,
  FilePdfOutlined,
  MailOutlined,
  LockOutlined,
  CopyOutlined,
  StopOutlined,
} from '@ant-design/icons';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { OrderForm, toApiPayload, type OrderFormValues } from '@/components/admin/orders/OrderForm';
import { GarmentAccordion } from '@/components/admin/orders/GarmentAccordion';
import { ShareLinkPanel } from '@/components/admin/orders/ShareLinkPanel';
import { OrderStatusBadge } from '@/components/admin/orders/OrderStatusBadge';
import { AuditLogTab } from '@/components/admin/orders/AuditLogTab';
import { RosterPanel } from '@/components/admin/orders/RosterPanel';
import type { MockupImage } from '@/components/admin/orders/MockupUploader';

interface SizingRow {
  id?: string;
  size?: string | null;
  playerName?: string | null;
  playerNumber?: string | null;
  notes?: string | null;
  sortOrder?: number;
}

interface GarmentData {
  id: string;
  name: string;
  fabrics: string[];
  notes: string | null;
  sortOrder: number;
  sizing: SizingRow[];
  images: MockupImage[];
  sizeChartIds: string[];
}

export interface AdminOrderData {
  id: string;
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  customerContact: string | null;
  clubName: string | null;
  orderValueAmount: string | null;
  orderValueCurrency: string | null;
  invoiceUrl: string | null;
  expectedShipDate: string | null;
  deadlineDate: string | null;
  generalNotes: string | null;
  internalNotes: string | null;
  shippingMode: 'prefilled' | 'customer_entered' | 'later';
  status: string;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
  colorSampleRequestedAt: string | null;
  changesRequestedComment: string | null;
  changesRequestedCount: number;
  garments: GarmentData[];
  currentAccess: {
    id: string;
    createdAt: string;
    revokedAt: string | null;
    hasAccessCode: boolean;
  } | null;
}

const RESENDABLE_STATUSES = new Set(['sent', 'viewed', 'changes_requested']);
const CANCELLABLE_STATUSES = new Set(['sent', 'viewed', 'changes_requested']);

interface Props {
  order: AdminOrderData;
}

export function OrderDetailView({ order }: Props) {
  const { message } = App.useApp();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab = searchParams.get('tab') ?? 'details';
  const [form] = Form.useForm<OrderFormValues>();
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [resending, setResending] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [colorSampleRequestedAt, setColorSampleRequestedAt] = useState(order.colorSampleRequestedAt);
  const [resolvingColorSample, setResolvingColorSample] = useState(false);
  const [currentStatus, setCurrentStatus] = useState(order.status);
  const [internalNotes, setInternalNotes] = useState(order.internalNotes ?? '');
  const [hasActiveToken, setHasActiveToken] = useState(
    order.currentAccess !== null && order.currentAccess.revokedAt === null,
  );
  const [tokenCreatedAt, setTokenCreatedAt] = useState(order.currentAccess?.createdAt ?? null);
  // Bumped whenever the header's "Resend link" action changes the token, forcing
  // ShareLinkPanel to remount and pick up the new hasActiveToken/tokenCreatedAt props
  // (it otherwise only reads them once, on its own initial mount).
  const [shareLinkVersion, setShareLinkVersion] = useState(0);

  const initialValues: Partial<OrderFormValues> = {
    customerName: order.customerName,
    customerEmail: order.customerEmail,
    customerContact: order.customerContact ?? undefined,
    clubName: order.clubName ?? undefined,
    orderValueAmount: order.orderValueAmount ? Number(order.orderValueAmount) : undefined,
    orderValueCurrency: order.orderValueCurrency ?? 'NZD',
    invoiceUrl: order.invoiceUrl ?? undefined,
    expectedShipDate: order.expectedShipDate ?? undefined,
    deadlineDate: order.deadlineDate ?? undefined,
    generalNotes: order.generalNotes ?? undefined,
    shippingMode: order.shippingMode,
  };

  async function saveDetails() {
    let values: OrderFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    setSaving(true);
    try {
      const payload = toApiPayload(values as unknown as Record<string, unknown>);
      const body = {
        customerName: payload.customerName,
        customerEmail: payload.customerEmail,
        customerContact: payload.customerContact ?? null,
        clubName: payload.clubName ?? null,
        orderValueAmount: payload.orderValueAmount != null ? Number(payload.orderValueAmount) : null,
        orderValueCurrency: payload.orderValueCurrency,
        invoiceUrl: payload.invoiceUrl ?? null,
        expectedShipDate: payload.expectedShipDate ?? null,
        deadlineDate: payload.deadlineDate ?? null,
        generalNotes: payload.generalNotes ?? null,
        internalNotes: internalNotes || null,
        shippingMode: payload.shippingMode,
      };

      const res = await fetch(`/api/admin/orders/${order.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error('Save failed');
      message.success('Order details saved');
    } catch {
      message.error('Failed to save order details');
    } finally {
      setSaving(false);
    }
  }

  async function deleteOrder() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/orders/${order.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? 'Delete failed');
      }
      message.success('Order deleted');
      router.push('/admin/orders');
    } catch (err: unknown) {
      message.error(err instanceof Error ? err.message : 'Failed to delete order');
      setDeleting(false);
    }
  }

  async function resendLink() {
    setResending(true);
    try {
      const res = await fetch(`/api/admin/orders/${order.id}/send-link`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.status === 503) {
        message.error('Email delivery is not configured on this server.');
        return;
      }
      if (!res.ok) throw new Error(data.error ?? 'Failed to send email');
      setHasActiveToken(true);
      setTokenCreatedAt(new Date().toISOString());
      setShareLinkVersion((v) => v + 1);
      message.success(`Link emailed to ${order.customerEmail}`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to send email');
    } finally {
      setResending(false);
    }
  }

  async function duplicateOrder() {
    setDuplicating(true);
    try {
      const res = await fetch(`/api/admin/orders/${order.id}/duplicate`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Failed to duplicate order');
      message.success(`Created ${data.orderNumber} from this order`);
      router.push(`/admin/orders/${data.orderId}`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to duplicate order');
      setDuplicating(false);
    }
  }

  async function cancelOrder() {
    setCancelling(true);
    try {
      const res = await fetch(`/api/admin/orders/${order.id}/cancel`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? 'Failed to cancel order');
      }
      setCurrentStatus('cancelled');
      setHasActiveToken(false);
      setShareLinkVersion((v) => v + 1);
      message.success('Order cancelled');
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to cancel order');
    } finally {
      setCancelling(false);
    }
  }

  async function resolveColorSample() {
    setResolvingColorSample(true);
    try {
      const res = await fetch(`/api/admin/orders/${order.id}/resolve-color-sample`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? 'Failed to resolve colour sample request');
      }
      setColorSampleRequestedAt(null);
      message.success('Colour sample request marked as resolved');
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to resolve colour sample request');
    } finally {
      setResolvingColorSample(false);
    }
  }

  const tabItems = [
    {
      key: 'details',
      label: 'Details',
      children: (
        <Space direction="vertical" style={{ width: '100%' }} size={16}>
          {currentStatus === 'cancelled' && (
            <Alert
              type="error"
              showIcon
              message="This order has been cancelled."
              description="The customer's link has been revoked. Duplicate this order if the deal is revived."
            />
          )}
          {currentStatus === 'confirmed' && (
            <Alert
              type="success"
              showIcon
              message="This order has been confirmed by the customer."
              description={
                order.confirmedAt
                  ? `Confirmed on ${new Date(order.confirmedAt).toLocaleString('en-NZ')}`
                  : undefined
              }
            />
          )}
          {colorSampleRequestedAt && (
            <Alert
              type="warning"
              showIcon
              icon={<BgColorsOutlined />}
              message="Customer requested a colour book / physical sample — hold production."
              description={
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  <span>{`Requested on ${new Date(colorSampleRequestedAt).toLocaleString('en-NZ')}. Arrange colour matching with the customer before releasing this order to production.`}</span>
                  <Popconfirm
                    title="Mark colour sample request as resolved?"
                    description="This clears the hold-production alert. Only confirm once colour matching has actually been arranged with the customer."
                    onConfirm={resolveColorSample}
                    okText="Yes, resolved"
                  >
                    <Button size="small" loading={resolvingColorSample}>
                      Mark Resolved
                    </Button>
                  </Popconfirm>
                </Space>
              }
            />
          )}
          {currentStatus === 'changes_requested' && (
            <Alert
              type="warning"
              showIcon
              message={
                order.changesRequestedCount > 1
                  ? `Customer has requested changes (round ${order.changesRequestedCount}).`
                  : 'Customer has requested changes.'
              }
              description={
                order.changesRequestedComment
                  ? `"${order.changesRequestedComment}" — Update the order and send a new link when ready.`
                  : 'Update the order details and send a new link when ready.'
              }
            />
          )}
          <OrderForm form={form} initialValues={initialValues} />
          <Card
            size="small"
            style={{ borderColor: '#faad14', background: 'rgba(250, 173, 20, 0.06)' }}
          >
            <Typography.Text strong>
              <LockOutlined style={{ color: '#faad14', marginRight: 6 }} />
              Internal notes — staff only, never shown to the customer
            </Typography.Text>
            <Input.TextArea
              rows={3}
              value={internalNotes}
              onChange={(e) => setInternalNotes(e.target.value)}
              placeholder="e.g. customer called, wants to hold shipment; discount approved by manager"
              style={{ resize: 'vertical', marginTop: 8 }}
            />
          </Card>
          <Space>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={saving}
              onClick={saveDetails}
            >
              Save details
            </Button>
            {currentStatus === 'draft' && (
              <Popconfirm
                title="Delete this order?"
                description="This action cannot be undone. Only draft orders can be deleted."
                onConfirm={deleteOrder}
                okText="Delete"
                okType="danger"
              >
                <Button danger icon={<DeleteOutlined />} loading={deleting}>
                  Delete order
                </Button>
              </Popconfirm>
            )}
          </Space>
        </Space>
      ),
    },
    {
      key: 'garments',
      label: `Garments (${order.garments.length})`,
      children: (
        <GarmentAccordion orderId={order.id} initialGarments={order.garments} />
      ),
    },
    {
      key: 'share',
      label: 'Share Link',
      children: (
        <ShareLinkPanel
          key={shareLinkVersion}
          orderId={order.id}
          customerEmail={order.customerEmail}
          hasActiveToken={hasActiveToken}
          tokenCreatedAt={tokenCreatedAt}
          hasAccessCode={order.currentAccess?.hasAccessCode ?? false}
          garmentSummary={{
            total: order.garments.length,
            missingSizing: order.garments.filter((g) => g.sizing.length === 0).map((g) => g.name),
            missingImages: order.garments.filter((g) => g.images.length === 0).map((g) => g.name),
          }}
        />
      ),
    },
    {
      key: 'roster',
      label: 'Team Roster',
      children: <RosterPanel orderId={order.id} customerEmail={order.customerEmail} />,
    },
    {
      key: 'audit',
      label: 'Audit Log',
      children: <AuditLogTab orderId={order.id} />,
    },
  ];

  return (
    <div style={{ maxWidth: 900 }}>
      <Breadcrumb
        style={{ marginBottom: 16 }}
        items={[
          { title: <Link href="/admin/orders">Orders</Link> },
          { title: order.orderNumber },
        ]}
      />

      <div
        style={{
          marginBottom: 24,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <Link href="/admin/orders">
          <Button icon={<ArrowLeftOutlined />} type="text" />
        </Link>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {order.orderNumber}
        </Typography.Title>
        <OrderStatusBadge status={currentStatus} />
        {order.customerName && (
          <Typography.Text type="secondary">— {order.customerName}</Typography.Text>
        )}
        {order.clubName && (
          <Typography.Text type="secondary">/ {order.clubName}</Typography.Text>
        )}
        <div style={{ marginLeft: 'auto' }}>
          <Space>
            {RESENDABLE_STATUSES.has(currentStatus) && (
              <Tooltip
                title={`Generates a fresh link and emails it to ${order.customerEmail} — this invalidates the current link the customer may already have`}
              >
                <Button icon={<MailOutlined />} loading={resending} onClick={resendLink}>
                  Resend link
                </Button>
              </Tooltip>
            )}
            {currentStatus === 'confirmed' && (
              <Button
                icon={<FilePdfOutlined />}
                href={`/api/admin/orders/${order.id}/pdf`}
                target="_blank"
                download
              >
                Download PDF
              </Button>
            )}
            <Tooltip title="Creates a new draft order pre-filled with this order's customer, garments, sizing, and size charts (mock-ups are not copied)">
              <Button icon={<CopyOutlined />} loading={duplicating} onClick={duplicateOrder}>
                Duplicate
              </Button>
            </Tooltip>
            {CANCELLABLE_STATUSES.has(currentStatus) && (
              <Popconfirm
                title="Cancel this order?"
                description="This marks the order as dead and immediately revokes the customer's link. This cannot be undone."
                onConfirm={cancelOrder}
                okText="Cancel order"
                okType="danger"
              >
                <Button danger icon={<StopOutlined />} loading={cancelling}>
                  Cancel order
                </Button>
              </Popconfirm>
            )}
          </Space>
        </div>
      </div>

      <Card styles={{ body: { padding: 0 } }}>
        <Tabs
          items={tabItems}
          defaultActiveKey={initialTab}
          style={{ padding: '0 16px 24px' }}
          tabBarStyle={{ marginBottom: 0 }}
          destroyOnHidden={false}
        />
      </Card>
    </div>
  );
}
