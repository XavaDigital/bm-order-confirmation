'use client';

import { Modal, Button, Space, Typography } from 'antd';
import { BgColorsOutlined } from '@ant-design/icons';
import { BEASTMODE } from '@/lib/theme';
import { SALES_REP_LABEL } from '@/lib/config';

interface Props {
  open: boolean;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}

export function RequestColorSampleModal({ open, submitting, onCancel, onConfirm }: Props) {
  function handleCancel() {
    if (submitting) return;
    onCancel();
  }

  return (
    <Modal
      open={open}
      onCancel={handleCancel}
      closable={!submitting}
      maskClosable={!submitting}
      footer={null}
      title={
        <span style={{ color: '#1677ff' }}>
          <BgColorsOutlined style={{ marginRight: 8 }} />
          Request a Colour Sample
        </span>
      }
      styles={{
        content: {
          background: BEASTMODE.charcoal,
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 8,
        },
        header: { background: BEASTMODE.charcoal, borderBottom: '1px solid rgba(255,255,255,0.08)' },
        mask: { backdropFilter: 'blur(4px)' },
      }}
    >
      <Typography.Text
        style={{ color: 'rgba(255,255,255,0.65)', display: 'block', marginBottom: 20, lineHeight: 1.6 }}
      >
        This notifies your {SALES_REP_LABEL} to arrange a colour book or physical sample with you
        for colour matching. <strong style={{ color: '#fff' }}>Production will be held</strong> on
        this order until it&apos;s resolved. You can still confirm the rest of your order now if
        you&apos;d like.
      </Typography.Text>

      <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
        <Button onClick={handleCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button
          type="primary"
          onClick={onConfirm}
          loading={submitting}
          icon={<BgColorsOutlined />}
        >
          Yes, Request Sample
        </Button>
      </Space>
    </Modal>
  );
}
