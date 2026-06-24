'use client';

import { Form, Input, Typography, Alert } from 'antd';
import { EnvironmentOutlined } from '@ant-design/icons';

interface Address {
  line1?: string;
  line2?: string;
  city?: string;
  region?: string;
  postcode?: string;
  country?: string;
}

interface Props {
  mode: 'prefilled' | 'customer_entered' | 'later';
  prefilledAddress?: unknown;
  onChange?: (address: Address) => void;
}

function renderPrefilled(addr: unknown) {
  if (!addr || typeof addr !== 'object') {
    return <Typography.Text style={{ color: 'rgba(255,255,255,0.5)' }}>No address provided</Typography.Text>;
  }
  const a = addr as Record<string, string>;
  const parts = [a.line1, a.line2, a.city, a.region, a.postcode, a.country].filter(Boolean);
  return (
    <Typography.Text style={{ color: 'rgba(255,255,255,0.85)', whiteSpace: 'pre-line' }}>
      {parts.join('\n')}
    </Typography.Text>
  );
}

export function ShippingAddressField({ mode, prefilledAddress, onChange }: Props) {
  if (mode === 'later') {
    return (
      <Alert
        type="info"
        showIcon
        icon={<EnvironmentOutlined />}
        message="Shipping address will be confirmed separately with your sales representative."
        style={{ background: 'rgba(24,144,255,0.08)', border: '1px solid rgba(24,144,255,0.25)' }}
      />
    );
  }

  if (mode === 'prefilled') {
    return (
      <div
        style={{
          padding: '12px 16px',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 6,
        }}
      >
        <EnvironmentOutlined style={{ color: 'rgba(255,255,255,0.4)', marginRight: 8 }} />
        {renderPrefilled(prefilledAddress)}
      </div>
    );
  }

  // customer_entered
  return (
    <Form layout="vertical" onValuesChange={(_, all) => onChange?.(all as Address)}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
        <Form.Item name="line1" label={<span style={{ color: 'rgba(255,255,255,0.75)' }}>Address Line 1</span>}
          rules={[{ required: true, message: 'Required' }]} style={{ gridColumn: '1 / -1' }}>
          <Input placeholder="123 Main Street" />
        </Form.Item>
        <Form.Item name="line2" label={<span style={{ color: 'rgba(255,255,255,0.75)' }}>Line 2</span>}
          style={{ gridColumn: '1 / -1' }}>
          <Input placeholder="Suburb / Unit" />
        </Form.Item>
        <Form.Item name="city" label={<span style={{ color: 'rgba(255,255,255,0.75)' }}>City</span>}
          rules={[{ required: true, message: 'Required' }]}>
          <Input placeholder="Auckland" />
        </Form.Item>
        <Form.Item name="postcode" label={<span style={{ color: 'rgba(255,255,255,0.75)' }}>Postcode</span>}>
          <Input placeholder="1010" />
        </Form.Item>
        <Form.Item name="region" label={<span style={{ color: 'rgba(255,255,255,0.75)' }}>Region / State</span>}>
          <Input placeholder="Auckland" />
        </Form.Item>
        <Form.Item name="country" label={<span style={{ color: 'rgba(255,255,255,0.75)' }}>Country</span>}
          rules={[{ required: true, message: 'Required' }]}>
          <Input placeholder="New Zealand" defaultValue="New Zealand" />
        </Form.Item>
      </div>
    </Form>
  );
}
