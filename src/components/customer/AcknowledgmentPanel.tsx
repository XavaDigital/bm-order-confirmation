'use client';

import { Checkbox, Space, Typography } from 'antd';
import { CheckCircleOutlined } from '@ant-design/icons';

export interface Ack {
  key: string;
  text: string;
}

export const ACKNOWLEDGMENTS: Ack[] = [
  {
    key: 'mockup_correct',
    text: 'I confirm the mock-up designs shown are correct and approved for production.',
  },
  {
    key: 'sizing_correct',
    text: 'I confirm all sizing information entered above is correct for each player / person.',
  },
  {
    key: 'fabrics_accepted',
    text: 'I accept the fabrics, materials, and construction details shown for each garment.',
  },
  {
    key: 'delivery_noted',
    text: 'I acknowledge the expected ship date and understand it is subject to production schedules.',
  },
  {
    key: 'no_changes',
    text: 'I understand that once confirmed, changes to designs, sizing, or specifications cannot be made.',
  },
  {
    key: 'payment_terms',
    text: 'I agree to the payment terms and conditions associated with this order.',
  },
  {
    key: 'authorised',
    text: 'I confirm that I am authorised to approve and confirm this order on behalf of my organisation.',
  },
];

interface Props {
  checked: Set<string>;
  onChange: (checked: Set<string>) => void;
}

export function AcknowledgmentPanel({ checked, onChange }: Props) {
  function toggle(key: string) {
    const next = new Set(checked);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    onChange(next);
  }

  const allChecked = ACKNOWLEDGMENTS.every((a) => checked.has(a.key));

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 16,
        }}
      >
        <CheckCircleOutlined
          style={{
            fontSize: 18,
            color: allChecked ? '#52c41a' : 'rgba(255,255,255,0.3)',
          }}
        />
        <Typography.Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13 }}>
          {checked.size} of {ACKNOWLEDGMENTS.length} confirmed
        </Typography.Text>
      </div>

      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        {ACKNOWLEDGMENTS.map((ack) => (
          <div
            key={ack.key}
            onClick={() => toggle(ack.key)}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              padding: '12px 16px',
              background: checked.has(ack.key)
                ? 'rgba(82,196,26,0.08)'
                : 'rgba(255,255,255,0.04)',
              border: `1px solid ${checked.has(ack.key) ? 'rgba(82,196,26,0.35)' : 'rgba(255,255,255,0.1)'}`,
              borderRadius: 6,
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            <Checkbox
              checked={checked.has(ack.key)}
              onChange={() => toggle(ack.key)}
              onClick={(e) => e.stopPropagation()}
              style={{ marginTop: 1, flexShrink: 0 }}
            />
            <Typography.Text style={{ color: 'rgba(255,255,255,0.85)', lineHeight: 1.5 }}>
              {ack.text}
            </Typography.Text>
          </div>
        ))}
      </Space>
    </div>
  );
}
