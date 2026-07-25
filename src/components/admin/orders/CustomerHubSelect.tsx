'use client';

/**
 * Sales Hub customer typeahead (modeled on Design Flow's CustomerHubSelect):
 * searches the fleet CRM through this app's server proxy, lets staff link the
 * order to a hub customer or create a provisional one. Renders nothing when
 * the hub integration is not configured — the manual customer fields keep
 * working exactly as before.
 */
import { useEffect, useRef, useState } from 'react';
import { Select, Button, Modal, Space, Typography, App, Tag } from 'antd';
import { LinkOutlined, PlusOutlined } from '@ant-design/icons';
import { getJson, postJson, ApiError } from '@/lib/api-fetch';

export interface HubCustomerPick {
  id: string;
  name: string;
  email?: string | null;
}

interface Props {
  /** Currently-linked hub customer (shown as the selected value). */
  value?: HubCustomerPick | null;
  onSelect: (customer: HubCustomerPick | null) => void;
}

export function CustomerHubSelect({ value, onSelect }: Props) {
  const { message } = App.useApp();
  const [configured, setConfigured] = useState(false);
  const [options, setOptions] = useState<HubCustomerPick[]>([]);
  const [searching, setSearching] = useState(false);
  const [lastQuery, setLastQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [ambiguous, setAmbiguous] = useState<HubCustomerPick[] | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getJson<{ configured: boolean }>('/api/admin/hub/status')
      .then((s) => setConfigured(s.configured))
      .catch(() => setConfigured(false));
  }, []);

  if (!configured) return null;

  function search(q: string) {
    setLastQuery(q);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (q.trim().length < 2) {
      setOptions([]);
      return;
    }
    debounceTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await getJson<HubCustomerPick[]>(
          `/api/admin/hub/customers/search?q=${encodeURIComponent(q.trim())}`,
        );
        setOptions(results);
      } catch {
        setOptions([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }

  async function createInHub() {
    const name = lastQuery.trim();
    if (!name) return;
    setCreating(true);
    try {
      const customer = await postJson<HubCustomerPick>(
        '/api/admin/hub/customers',
        { name },
        'Failed to create customer',
      );
      onSelect(customer);
      message.success(`Created "${customer.name}" in the Sales Hub`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as { candidates?: HubCustomerPick[] } | undefined;
        setAmbiguous(body?.candidates ?? []);
      } else {
        message.error(err instanceof Error ? err.message : 'Failed to create customer');
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <Space.Compact style={{ width: '100%' }}>
        <Select
          style={{ flex: 1 }}
          showSearch
          allowClear
          value={value?.id}
          placeholder={
            <span>
              <LinkOutlined style={{ marginRight: 6 }} />
              Search the Sales Hub CRM…
            </span>
          }
          filterOption={false}
          onSearch={search}
          loading={searching}
          notFoundContent={
            lastQuery.trim().length < 2 ? 'Type at least 2 characters' : searching ? 'Searching…' : 'No matches'
          }
          onChange={(id) => {
            if (!id) {
              onSelect(null);
              return;
            }
            const picked = options.find((o) => o.id === id) ?? (value?.id === id ? value : null);
            if (picked) onSelect(picked);
          }}
          options={(value && !options.some((o) => o.id === value.id)
            ? [value, ...options]
            : options
          ).map((o) => ({
            value: o.id,
            label: o.email ? `${o.name} — ${o.email}` : o.name,
          }))}
        />
        <Button
          icon={<PlusOutlined />}
          loading={creating}
          disabled={lastQuery.trim().length < 2}
          onClick={createInHub}
          title="Create this customer in the Sales Hub"
        >
          Create
        </Button>
      </Space.Compact>

      <Modal
        title="Which customer is this?"
        open={ambiguous !== null}
        onCancel={() => setAmbiguous(null)}
        footer={null}
      >
        <Typography.Paragraph type="secondary">
          The Sales Hub found more than one plausible match — pick the right one.
        </Typography.Paragraph>
        <Space direction="vertical" style={{ width: '100%' }}>
          {(ambiguous ?? []).map((candidate) => (
            <Button
              key={candidate.id}
              block
              onClick={() => {
                onSelect(candidate);
                setAmbiguous(null);
              }}
            >
              {candidate.name}
              {candidate.email && <Tag style={{ marginLeft: 8 }}>{candidate.email}</Tag>}
            </Button>
          ))}
        </Space>
      </Modal>
    </>
  );
}
