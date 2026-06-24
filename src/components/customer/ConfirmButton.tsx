'use client';

import { Button, Popconfirm, Tooltip } from 'antd';
import { CheckOutlined } from '@ant-design/icons';
import { ACKNOWLEDGMENTS } from './AcknowledgmentPanel';

interface Props {
  checkedAcks: Set<string>;
  onConfirm: () => void;
  loading: boolean;
}

export function ConfirmButton({ checkedAcks, onConfirm, loading }: Props) {
  const allChecked = ACKNOWLEDGMENTS.every((a) => checkedAcks.has(a.key));
  const remaining = ACKNOWLEDGMENTS.length - checkedAcks.size;

  const btn = (
    <Button
      type="primary"
      size="large"
      icon={<CheckOutlined />}
      disabled={!allChecked}
      loading={loading}
      style={{
        height: 52,
        minWidth: 220,
        fontSize: 16,
        fontWeight: 700,
        letterSpacing: 1,
        textTransform: 'uppercase',
        opacity: allChecked ? 1 : 0.5,
      }}
    >
      Confirm Order
    </Button>
  );

  if (!allChecked) {
    return (
      <Tooltip
        title={`Please tick all ${remaining} remaining acknowledgment${remaining !== 1 ? 's' : ''} above`}
      >
        {btn}
      </Tooltip>
    );
  }

  return (
    <Popconfirm
      title="Confirm this order?"
      description="Once confirmed, changes cannot be made. Please ensure all details are correct."
      onConfirm={onConfirm}
      okText="Yes, confirm"
      cancelText="Go back"
      okButtonProps={{ size: 'large' }}
      cancelButtonProps={{ size: 'large' }}
    >
      {btn}
    </Popconfirm>
  );
}
