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
} from 'antd';
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  SaveOutlined,
  FilePdfOutlined,
} from '@ant-design/icons';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { OrderForm, toApiPayload, type OrderFormValues } from '@/components/admin/orders/OrderForm';
import { GarmentAccordion } from '@/components/admin/orders/GarmentAccordion';
import { ShareLinkPanel } from '@/components/admin/orders/ShareLinkPanel';
import { OrderStatusBadge } from '@/components/admin/orders/OrderStatusBadge';
import { AuditLogTab } from '@/components/admin/orders/AuditLogTab';
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
  shippingMode: 'prefilled' | 'customer_entered' | 'later';
  status: string;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
  changesRequestedComment: string | null;
  garments: GarmentData[];
  currentAccess: {
    id: string;
    createdAt: string;
    revokedAt: string | null;
  } | null;
}

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
  const [currentStatus, setCurrentStatus] = useState(order.status);

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

  const hasActiveToken =
    order.currentAccess !== null && order.currentAccess.revokedAt === null;

  const tabItems = [
    {
      key: 'details',
      label: 'Details',
      children: (
        <Space direction="vertical" style={{ width: '100%' }} size={16}>
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
          {currentStatus === 'changes_requested' && (
            <Alert
              type="warning"
              showIcon
              message="Customer has requested changes."
              description={
                order.changesRequestedComment
                  ? `"${order.changesRequestedComment}" — Update the order and send a new link when ready.`
                  : 'Update the order details and send a new link when ready.'
              }
            />
          )}
          <OrderForm form={form} initialValues={initialValues} />
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
          orderId={order.id}
          customerEmail={order.customerEmail}
          hasActiveToken={hasActiveToken}
          tokenCreatedAt={order.currentAccess?.createdAt ?? null}
        />
      ),
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
        </div>
      </div>

      <Card bodyStyle={{ padding: 0 }}>
        <Tabs
          items={tabItems}
          defaultActiveKey={initialTab}
          style={{ padding: '0 16px 24px' }}
          tabBarStyle={{ marginBottom: 0 }}
          destroyInactiveTabPane={false}
        />
      </Card>
    </div>
  );
}
