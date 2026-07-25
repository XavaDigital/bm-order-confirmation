'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Form,
  Input,
  Select,
  Button,
  Space,
  Typography,
  Card,
  App,
  Breadcrumb,
  Divider,
} from 'antd';
import { ArrowLeftOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import Link from 'next/link';
import { OrderForm, toApiPayload, type OrderFormValues } from '@/components/admin/orders/OrderForm';
import { CustomerHubSelect, type HubCustomerPick } from '@/components/admin/orders/CustomerHubSelect';
import { getJson, postJson } from '@/lib/api-fetch';

const { Title } = Typography;

interface GarmentEntry {
  key: string;
  name: string;
  garmentTypeId?: string;
}

interface GarmentTypeOption {
  id: string;
  name: string;
  category: string | null;
}

export default function NewOrderPage() {
  const { message } = App.useApp();
  const router = useRouter();
  const [form] = Form.useForm<OrderFormValues>();
  const [garments, setGarments] = useState<GarmentEntry[]>([
    { key: '1', name: '' },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [types, setTypes] = useState<GarmentTypeOption[]>([]);
  const [hubCustomer, setHubCustomer] = useState<HubCustomerPick | null>(null);

  useEffect(() => {
    getJson<GarmentTypeOption[]>('/api/admin/garment-types?active=1', 'Failed to load garment types')
      .then(setTypes)
      .catch(() => {
        // Optional enhancement — plain garment names still work.
      });
  }, []);

  function setGarmentType(key: string, garmentTypeId: string | undefined) {
    setGarments((prev) =>
      prev.map((g) => {
        if (g.key !== key) return g;
        // Auto-fill an empty name from the type's name
        const typeName = types.find((t) => t.id === garmentTypeId)?.name;
        return {
          ...g,
          garmentTypeId,
          name: g.name.trim() === '' && typeName ? typeName : g.name,
        };
      }),
    );
  }

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
        garments: garmentList.map((g) => ({
          name: g.name.trim(),
          ...(g.garmentTypeId && { garmentTypeId: g.garmentTypeId }),
        })),
        ...(hubCustomer && {
          hubCustomerId: hubCustomer.id,
          hubCustomerName: hubCustomer.name,
        }),
      };

      const result = await postJson<{ orderId: string; orderNumber: string }>(
        '/api/admin/orders',
        body,
        'Failed to create order',
      );
      if (!result?.orderId) throw new Error('Create succeeded but no order id was returned');
      message.success(`Order ${result.orderNumber} created`);
      // Keep `submitting` true through the navigation — re-enabling the button
      // here allows a double-submit that silently creates a second order.
      router.push(`/admin/orders/${result.orderId}`);
      router.refresh();
    } catch (err: unknown) {
      message.error(err instanceof Error ? err.message : 'Failed to create order');
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
        {/* Renders nothing unless the Sales Hub integration is configured */}
        <div style={{ marginBottom: 16 }}>
          <CustomerHubSelect
            value={hubCustomer}
            onSelect={(customer) => {
              setHubCustomer(customer);
              if (customer) {
                form.setFieldsValue({
                  customerName: customer.name,
                  ...(customer.email && { customerEmail: customer.email }),
                });
              }
            }}
          />
        </div>
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
              {types.length > 0 && (
                <Select
                  value={g.garmentTypeId}
                  onChange={(v) => setGarmentType(g.key, v)}
                  allowClear
                  placeholder="Type (optional)"
                  style={{ width: 220 }}
                  showSearch
                  optionFilterProp="label"
                  options={types.map((t) => ({
                    value: t.id,
                    label: t.category ? `${t.name} (${t.category})` : t.name,
                  }))}
                />
              )}
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
