'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Form,
  Input,
  Button,
  Space,
  Typography,
  Card,
  message,
  Breadcrumb,
  Divider,
} from 'antd';
import { ArrowLeftOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import Link from 'next/link';
import { OrderForm, toApiPayload, type OrderFormValues } from '@/components/admin/orders/OrderForm';

const { Title } = Typography;

interface GarmentEntry {
  key: string;
  name: string;
}

export default function NewOrderPage() {
  const router = useRouter();
  const [form] = Form.useForm<OrderFormValues>();
  const [garments, setGarments] = useState<GarmentEntry[]>([
    { key: '1', name: '' },
  ]);
  const [submitting, setSubmitting] = useState(false);

  function addGarment() {
    setGarments((prev) => [...prev, { key: String(Date.now()), name: '' }]);
  }

  function removeGarment(key: string) {
    if (garments.length <= 1) {
      message.warning('An order needs at least one garment');
      return;
    }
    setGarments((prev) => prev.filter((g) => g.key !== key));
  }

  function setGarmentName(key: string, name: string) {
    setGarments((prev) => prev.map((g) => (g.key === key ? { ...g, name } : g)));
  }

  async function handleSubmit() {
    let values: OrderFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return; // antd shows field errors
    }

    const garmentList = garments.filter((g) => g.name.trim());
    if (garmentList.length === 0) {
      message.error('Add at least one garment name');
      return;
    }

    setSubmitting(true);
    try {
      const payload = toApiPayload(values as unknown as Record<string, unknown>);

      const body = {
        source: 'internal_admin',
        customer: {
          name: payload.customerName,
          email: payload.customerEmail,
          contact: payload.customerContact ?? undefined,
          clubName: payload.clubName ?? undefined,
        },
        orderValue:
          payload.orderValueAmount != null
            ? {
                amount: Number(payload.orderValueAmount),
                currency: payload.orderValueCurrency ?? 'NZD',
              }
            : undefined,
        invoiceUrl: payload.invoiceUrl ?? undefined,
        expectedShipDate: payload.expectedShipDate ?? undefined,
        deadlineDate: payload.deadlineDate ?? undefined,
        generalNotes: payload.generalNotes ?? undefined,
        shipping: {
          mode: payload.shippingMode ?? 'prefilled',
        },
        garments: garmentList.map((g) => ({ name: g.name.trim() })),
      };

      const res = await fetch('/api/admin/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? 'Failed to create order');
      }

      const result: { orderId: string; orderNumber: string } = await res.json();
      message.success(`Order ${result.orderNumber} created`);
      router.push(`/admin/orders/${result.orderId}`);
    } catch (err: unknown) {
      message.error(err instanceof Error ? err.message : 'Failed to create order');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ maxWidth: 860 }}>
      <Breadcrumb
        style={{ marginBottom: 16 }}
        items={[
          { title: <Link href="/admin/orders">Orders</Link> },
          { title: 'New Order' },
        ]}
      />

      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link href="/admin/orders">
          <Button icon={<ArrowLeftOutlined />} type="text" />
        </Link>
        <Title level={3} style={{ margin: 0 }}>
          New Order
        </Title>
      </div>

      <Card>
        <OrderForm form={form} />

        <Divider />

        <Title level={5} style={{ marginTop: 0 }}>
          Garments
        </Title>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
          Add garment names now. You can upload mock-ups and sizing after saving.
        </Typography.Paragraph>

        <Space direction="vertical" style={{ width: '100%' }} size={8}>
          {garments.map((g) => (
            <div key={g.key} style={{ display: 'flex', gap: 8 }}>
              <Input
                value={g.name}
                placeholder="Garment name (e.g. Home Jersey)"
                onChange={(e) => setGarmentName(g.key, e.target.value)}
                style={{ maxWidth: 400 }}
              />
              <Button
                icon={<DeleteOutlined />}
                type="text"
                danger
                onClick={() => removeGarment(g.key)}
                disabled={garments.length === 1}
              />
            </div>
          ))}
          <Button
            size="small"
            icon={<PlusOutlined />}
            onClick={addGarment}
            style={{ width: 'fit-content' }}
          >
            Add another garment
          </Button>
        </Space>

        <Divider />

        <Space>
          <Button
            type="primary"
            size="large"
            loading={submitting}
            onClick={handleSubmit}
          >
            Create Order
          </Button>
          <Link href="/admin/orders">
            <Button size="large" disabled={submitting}>
              Cancel
            </Button>
          </Link>
        </Space>
      </Card>
    </div>
  );
}
