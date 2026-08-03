'use client';

/**
 * Pick the hub CONTACT who placed the order, within the linked hub customer.
 * Renders nothing until a customer is linked — a contact only means something
 * inside its customer. Options are that customer's ACTIVE contacts (the hub's
 * picker contract); a previously-saved contact who has since left the customer
 * still renders as the selected value via the snapshot name, per fleet trap 3.
 *
 * "Add a contact" creates the person in the CRM (hub POST /contacts via our
 * proxy) and selects them. The create sends customerId so the hub can attach
 * the membership the day it supports it (fleet thread ask, 2026-08-03);
 * until then the contact exists un-membered but is fully usable as the
 * order's contact.
 */
import { useEffect, useState } from 'react';
import { App, Button, Divider, Form, Input, Modal, Select, Space, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { ApiError, getJson, postJson } from '@/lib/api-fetch';

export interface HubContactPick {
  id: string;
  name: string;
  email?: string | null;
}

interface Props {
  /** The linked hub customer — null hides the picker entirely. */
  customerId: string | null;
  value?: HubContactPick | null;
  onSelect: (contact: HubContactPick | null) => void;
}

interface NewContactValues {
  firstName: string;
  lastName?: string;
  email?: string;
}

export function ContactHubSelect({ customerId, value, onSelect }: Props) {
  const { message } = App.useApp();
  const [options, setOptions] = useState<HubContactPick[]>([]);
  const [loading, setLoading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm<NewContactValues>();

  useEffect(() => {
    if (!customerId) {
      setOptions([]);
      return;
    }
    setLoading(true);
    getJson<{ contacts: HubContactPick[] }>(
      `/api/admin/hub/customers/${customerId}/contacts`,
      'Failed to load contacts',
    )
      .then((res) => setOptions(res.contacts))
      // Unconfigured/unreachable hub → empty picker, same posture as customer search.
      .catch(() => setOptions([]))
      .finally(() => setLoading(false));
  }, [customerId]);

  if (!customerId) return null;

  async function createContact() {
    let values: NewContactValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setCreating(true);
    try {
      const res = await postJson<{ contact: HubContactPick }>(
        '/api/admin/hub/contacts',
        {
          firstName: values.firstName.trim(),
          ...(values.lastName?.trim() && { lastName: values.lastName.trim() }),
          ...(values.email?.trim() && { email: values.email.trim() }),
          customerId,
        },
        'Could not create the contact',
      );
      setOptions((prev) => [res.contact, ...prev]);
      onSelect(res.contact);
      setAddOpen(false);
      form.resetFields();
      message.success(`${res.contact.name} added to the CRM`);
    } catch (err) {
      // The hub's refusals carry real reasons (address already claimed,
      // own-mailbox domain) — show them rather than a generic failure.
      message.error(err instanceof ApiError ? err.message : 'Could not create the contact');
    } finally {
      setCreating(false);
    }
  }

  // The saved contact may have left the customer (active-only options) — keep
  // it selectable so opening the dropdown doesn't blank a historical value.
  const merged =
    value && !options.some((o) => o.id === value.id) ? [value, ...options] : options;

  return (
    <Space direction="vertical" size={2} style={{ width: '100%' }}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        Contact (who placed the order)
      </Typography.Text>
      <Select
        allowClear
        showSearch
        optionFilterProp="label"
        loading={loading}
        placeholder="No contact selected"
        value={value?.id}
        style={{ maxWidth: 420, width: '100%' }}
        options={merged.map((c) => ({
          value: c.id,
          label: c.email ? `${c.name} (${c.email})` : c.name,
        }))}
        onChange={(id) => {
          const picked = merged.find((c) => c.id === id) ?? null;
          onSelect(picked ? { id: picked.id, name: picked.name, email: picked.email } : null);
        }}
        popupRender={(menu) => (
          <>
            {menu}
            <Divider style={{ margin: '4px 0' }} />
            <Button
              type="text"
              icon={<PlusOutlined />}
              style={{ width: '100%', textAlign: 'left' }}
              onClick={() => setAddOpen(true)}
            >
              Add a new contact…
            </Button>
          </>
        )}
      />

      <Modal
        open={addOpen}
        title="Add a CRM contact"
        onOk={() => void createContact()}
        onCancel={() => setAddOpen(false)}
        confirmLoading={creating}
        okText="Add contact"
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item
            label="First name"
            name="firstName"
            rules={[{ required: true, message: 'A first name is required' }]}
          >
            <Input placeholder="Jane" maxLength={100} autoFocus />
          </Form.Item>
          <Form.Item label="Last name" name="lastName">
            <Input placeholder="Coach" maxLength={100} />
          </Form.Item>
          <Form.Item
            label="Email"
            name="email"
            rules={[{ type: 'email', message: 'Enter a valid email address' }]}
            extra="Used to match this person to their emails in the CRM."
          >
            <Input placeholder="jane@club.nz" maxLength={200} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
