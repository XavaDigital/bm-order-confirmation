'use client';

import { Form, Input, InputNumber, Select, DatePicker, Typography } from 'antd';
import type { FormInstance } from 'antd';
import dayjs from 'dayjs';

const { TextArea } = Input;

export interface OrderFormValues {
  customerName: string;
  customerEmail: string;
  customerContact?: string;
  clubName?: string;
  orderValueAmount?: number | null;
  orderValueCurrency: string;
  invoiceUrl?: string;
  expectedShipDate?: string | null;
  deadlineDate?: string | null;
  generalNotes?: string;
  shippingMode: 'prefilled' | 'customer_entered' | 'later';
}

interface Props {
  /** Initial values for edit mode. Omit for new-order mode. */
  initialValues?: Partial<OrderFormValues>;
  form: FormInstance<OrderFormValues>;
  disabled?: boolean;
}

const CURRENCY_OPTIONS = [
  { value: 'NZD', label: 'NZD' },
  { value: 'AUD', label: 'AUD' },
  { value: 'USD', label: 'USD' },
];

const SHIPPING_OPTIONS = [
  { value: 'prefilled', label: 'Pre-filled by sales' },
  { value: 'customer_entered', label: 'Customer enters address' },
  { value: 'later', label: 'Provide later' },
];

export function OrderForm({ initialValues, form, disabled }: Props) {
  const defaults: Partial<OrderFormValues> = {
    orderValueCurrency: 'NZD',
    shippingMode: 'prefilled',
    ...initialValues,
  };

  // Convert date strings to dayjs for the DatePicker
  const formInitialValues = {
    ...defaults,
    expectedShipDate: defaults.expectedShipDate ? dayjs(defaults.expectedShipDate) : undefined,
    deadlineDate: defaults.deadlineDate ? dayjs(defaults.deadlineDate) : undefined,
  };

  return (
    <Form
      form={form}
      layout="vertical"
      initialValues={formInitialValues}
      disabled={disabled}
      size="middle"
    >
      <Typography.Title level={5} style={{ marginBottom: 16, marginTop: 0 }}>
        Customer
      </Typography.Title>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
        <Form.Item
          name="customerName"
          label="Customer Name"
          rules={[{ required: true, message: 'Required' }]}
        >
          <Input placeholder="Jane Smith" />
        </Form.Item>

        <Form.Item
          name="customerEmail"
          label="Email"
          rules={[
            { required: true, message: 'Required' },
            { type: 'email', message: 'Enter a valid email' },
          ]}
        >
          <Input placeholder="jane@teamclub.co.nz" />
        </Form.Item>

        <Form.Item name="customerContact" label="Contact / Phone">
          <Input placeholder="+64 21 000 000" />
        </Form.Item>

        <Form.Item name="clubName" label="Club / Team Name">
          <Input placeholder="Westside FC" />
        </Form.Item>
      </div>

      <Typography.Title level={5} style={{ marginBottom: 16, marginTop: 8 }}>
        Order Details
      </Typography.Title>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
        <Form.Item label="Order Value">
          <Input.Group compact>
            <Form.Item name="orderValueAmount" noStyle>
              <InputNumber
                placeholder="1500.00"
                min={0}
                precision={2}
                style={{ width: 'calc(100% - 90px)' }}
              />
            </Form.Item>
            <Form.Item name="orderValueCurrency" noStyle>
              <Select options={CURRENCY_OPTIONS} style={{ width: 90 }} />
            </Form.Item>
          </Input.Group>
        </Form.Item>

        <Form.Item
          name="invoiceUrl"
          label="Invoice URL"
          rules={[{ type: 'url', message: 'Enter a valid URL' }]}
        >
          <Input placeholder="https://xero.com/…" />
        </Form.Item>

        <Form.Item name="expectedShipDate" label="Expected Ship Date">
          <DatePicker style={{ width: '100%' }} format="DD MMM YYYY" />
        </Form.Item>

        <Form.Item name="deadlineDate" label="Deadline Date">
          <DatePicker style={{ width: '100%' }} format="DD MMM YYYY" />
        </Form.Item>
      </div>

      <Form.Item name="shippingMode" label="Shipping Address Mode">
        <Select options={SHIPPING_OPTIONS} style={{ maxWidth: 320 }} />
      </Form.Item>

      <Form.Item name="generalNotes" label="General Notes">
        <TextArea
          rows={3}
          placeholder="Internal notes visible to sales only (not shown to customer)"
          style={{ resize: 'vertical' }}
        />
      </Form.Item>
    </Form>
  );
}

/** Convert form values (with dayjs dates) to API-ready object. */
export function toApiPayload(values: Record<string, unknown>): Record<string, unknown> {
  return {
    ...values,
    expectedShipDate:
      values.expectedShipDate && dayjs.isDayjs(values.expectedShipDate)
        ? (values.expectedShipDate as ReturnType<typeof dayjs>).format('YYYY-MM-DD')
        : (values.expectedShipDate ?? null),
    deadlineDate:
      values.deadlineDate && dayjs.isDayjs(values.deadlineDate)
        ? (values.deadlineDate as ReturnType<typeof dayjs>).format('YYYY-MM-DD')
        : (values.deadlineDate ?? null),
  };
}
