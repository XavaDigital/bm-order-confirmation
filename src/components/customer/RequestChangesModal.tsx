'use client';

import { useState } from 'react';
import { Modal, Input, Button, Space, Typography } from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';
import { BEASTMODE } from '@/lib/theme';

interface Props {
  open: boolean;
  onCancel: () => void;
  onSubmit: (comment: string) => Promise<void>;
}

export function RequestChangesModal({ open, onCancel, onSubmit }: Props) {
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!comment.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit(comment.trim());
      setComment('');
    } finally {
      setSubmitting(false);
    }
  }

  function handleCancel() {
    if (submitting) return;
    setComment('');
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
        <span style={{ color: '#faad14' }}>
          <ExclamationCircleOutlined style={{ marginRight: 8 }} />
          Request Changes
        </span>
      }
      styles={{
        content: {
          background: BEASTMODE.charcoal,
          border: `1px solid rgba(255,255,255,0.12)`,
          borderRadius: 8,
        },
        header: { background: BEASTMODE.charcoal, borderBottom: '1px solid rgba(255,255,255,0.08)' },
        mask: { backdropFilter: 'blur(4px)' },
      }}
    >
      <Typography.Text
        style={{ color: 'rgba(255,255,255,0.65)', display: 'block', marginBottom: 16, lineHeight: 1.6 }}
      >
        Please describe what needs to change before you can confirm this order.
        Your BeastMode sales representative will be notified and will get back to you.
      </Typography.Text>

      <Input.TextArea
        rows={5}
        maxLength={2000}
        showCount
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="e.g. The sizing for jersey #7 needs to change from M to L, and the club logo colour should be navy not black…"
        style={{ resize: 'vertical', marginBottom: 20 }}
        autoFocus
      />

      <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
        <Button onClick={handleCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button
          danger
          type="primary"
          onClick={handleSubmit}
          loading={submitting}
          disabled={!comment.trim()}
          icon={<ExclamationCircleOutlined />}
        >
          Submit Request
        </Button>
      </Space>
    </Modal>
  );
}
