'use client';

import { Checkbox, Space, Typography } from 'antd';
import { CheckCircleOutlined } from '@ant-design/icons';
import { APP_NAME } from '@/lib/config';

export interface Ack {
  key: string;
  text: string;
}

// Items 1-7 mirror PROJECT_BRIEF.md §5 acks 1-7 exactly (wording adapted to
// British spelling to match the rest of the customer surface). Items 8-9 are
// business-process acknowledgments beyond the brief's list — the brief isn't
// exclusive ("the legally/operationally important confirmations", a "starting
// draft") and nothing else in the flow surfaces payment-terms or approval-
// authority consent, so they're kept as their own tracked acknowledgments.
export const ACKNOWLEDGMENTS: Ack[] = [
  {
    key: 'color_accuracy',
    text: 'I understand that colours may not print exactly as they appear on the mock-ups or on my screen. Screens display colour using light (RGB) while printing uses inks/dyes (CMYK and material differences), so some variation is expected.',
  },
  {
    key: 'color_matching',
    text: 'If I am highly concerned about exact colour matching, I understand I must request a colour book or send a physical sample for matching before production.',
  },
  {
    key: 'mockup_correct',
    text: 'I confirm the mock-up(s) shown are correct.',
  },
  {
    key: 'sizing_correct',
    text: 'I confirm the sizing, names, and numbers are correct.',
  },
  {
    key: 'size_charts_used',
    text: 'I confirm I used the provided size charts (not my own or legacy charts), because factory size standards differ from other brands.',
  },
  {
    key: 'no_refunds',
    text: `I understand that orders that are incorrect due to information I provided cannot be refunded. ${APP_NAME} takes responsibility only for manufacturing errors on our part.`,
  },
  {
    key: 'womens_unisex_sizing',
    text: "I acknowledge the difference between women's and unisex sizing and have accounted for it in my specifications.",
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
