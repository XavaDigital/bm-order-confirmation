'use client';

/**
 * "Order page contact & branding" — moved from the Details form into the Team
 * order page section (David, 2026-08-04): these fields identify the club
 * contact the team page and confirmation link are addressed to. Saves
 * independently of the Details form via the same PATCH endpoint.
 */
import { useState } from 'react';
import { App, Button, Form, Input, Typography } from 'antd';
import { SectionTitle } from '@/components/admin/SectionTitle';
import { patchJson } from '@/lib/api-fetch';

export interface OrderContactValues {
  customerName: string;
  customerEmail: string;
  customerContact: string | null;
  clubName: string | null;
}

interface Props {
  orderId: string;
  initial: OrderContactValues;
  /** CRM-linked orders may leave these blank — the server fills from the hub contact. */
  hubLinked: boolean;
  onSaved: (values: OrderContactValues) => void;
}

export function OrderContactPanel({ orderId, initial, hubLinked, onSaved }: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm<{
    customerName: string;
    customerEmail: string;
    customerContact?: string;
    clubName?: string;
  }>();
  const [saving, setSaving] = useState(false);

  async function save() {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      const body: OrderContactValues = {
        customerName: values.customerName,
        customerEmail: values.customerEmail,
        customerContact: values.customerContact?.trim() || null,
        clubName: values.clubName?.trim() || null,
      };
      await patchJson(`/api/admin/orders/${orderId}`, body, 'Save failed');
      message.success('Contact details saved');
      onSaved(body);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to save contact details');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <SectionTitle>Order page contact &amp; branding</SectionTitle>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16, fontSize: 13 }}>
        Shown on the customer-facing order page and used to email the links on this page.
        {hubLinked
          ? ' Optional — left blank, these fill from the linked CRM customer and contact; they must be set before the order page is sent.'
          : ''}
      </Typography.Paragraph>

      <Form
        form={form}
        layout="vertical"
        size="middle"
        initialValues={{
          customerName: initial.customerName,
          customerEmail: initial.customerEmail,
          customerContact: initial.customerContact ?? undefined,
          clubName: initial.clubName ?? undefined,
        }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
          <Form.Item
            name="customerName"
            label="Contact Name"
            rules={[{ required: !hubLinked, message: 'Required' }]}
          >
            <Input placeholder={hubLinked ? 'From CRM contact' : 'Jane Smith'} />
          </Form.Item>

          <Form.Item
            name="customerEmail"
            label="Email"
            rules={[
              { required: !hubLinked, message: 'Required' },
              { type: 'email', message: 'Enter a valid email' },
            ]}
          >
            <Input placeholder={hubLinked ? 'From CRM contact' : 'jane@teamclub.co.nz'} />
          </Form.Item>

          <Form.Item name="customerContact" label="Contact / Phone">
            <Input placeholder="+64 21 000 000" />
          </Form.Item>

          <Form.Item name="clubName" label="Club / Team Name">
            <Input placeholder="Westside FC" />
          </Form.Item>
        </div>
      </Form>

      <Button type="primary" loading={saving} onClick={() => void save()}>
        Save contact details
      </Button>
    </div>
  );
}
