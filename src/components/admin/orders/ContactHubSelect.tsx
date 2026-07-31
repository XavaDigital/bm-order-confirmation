'use client';

/**
 * Pick the hub CONTACT who placed the order, within the linked hub customer.
 * Renders nothing until a customer is linked — a contact only means something
 * inside its customer. Options are that customer's ACTIVE contacts (the hub's
 * picker contract); a previously-saved contact who has since left the customer
 * still renders as the selected value via the snapshot name, per fleet trap 3.
 */
import { useEffect, useState } from 'react';
import { Select, Space, Typography } from 'antd';
import { getJson } from '@/lib/api-fetch';

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

export function ContactHubSelect({ customerId, value, onSelect }: Props) {
  const [options, setOptions] = useState<HubContactPick[]>([]);
  const [loading, setLoading] = useState(false);

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
      />
    </Space>
  );
}
