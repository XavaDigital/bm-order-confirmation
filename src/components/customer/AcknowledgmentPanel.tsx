'use client';

import { Checkbox, Space, Typography } from 'antd';
import { CheckCircleOutlined } from '@ant-design/icons';

/**
 * One customer-confirmation checkbox. The set is admin-editable
 * (acknowledgement_settings, /admin/acknowledgements) and arrives via props
 * from the server component — no code-defined list since 2026-08-03. Each has
 * a TITLE rendered larger/bolder to draw attention (David), then the wording.
 */
export interface Ack {
  key: string;
  title: string;
  body: string;
}

interface Props {
  acks: Ack[];
  checked: Set<string>;
  onChange: (checked: Set<string>) => void;
}

export function AcknowledgmentPanel({ acks, checked, onChange }: Props) {
  function toggle(key: string) {
    const next = new Set(checked);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    onChange(next);
  }

  const allChecked = acks.every((a) => checked.has(a.key));

  return (
    <div>
      <div
        aria-live="polite"
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
          {checked.size} of {acks.length} confirmed
        </Typography.Text>
      </div>

      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        {acks.map((ack) => (
          <div
            key={ack.key}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              padding: '12px 16px',
              background: checked.has(ack.key)
                ? 'rgba(82,196,26,0.08)'
                : 'rgba(255,255,255,0.04)',
              border: `1px solid ${checked.has(ack.key) ? 'rgba(82,196,26,0.35)' : 'rgba(255,255,255,0.1)'}`,
              borderRadius: 6,
              transition: 'all 0.15s',
            }}
          >
            {/* Title + body as Checkbox children (not siblings) so antd wraps
                everything in one real <label> — accessible name +
                click-anywhere-to-toggle natively. */}
            <Checkbox
              checked={checked.has(ack.key)}
              onChange={() => toggle(ack.key)}
              style={{ alignItems: 'flex-start', width: '100%' }}
            >
              <Typography.Text
                strong
                style={{ color: 'rgba(255,255,255,0.95)', fontSize: 15, display: 'block', marginBottom: 2 }}
              >
                {ack.title}
              </Typography.Text>
              <Typography.Text style={{ color: 'rgba(255,255,255,0.85)', lineHeight: 1.5 }}>
                {ack.body}
              </Typography.Text>
            </Checkbox>
          </div>
        ))}
      </Space>
    </div>
  );
}
