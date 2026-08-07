'use client';

/**
 * The sidestep acknowledgement itself (David, 2026-08-06): asks for a reason
 * and says plainly what is being recorded — this is the moment someone
 * decides a check will not be done, and it should read like a decision, not a
 * dismissal. Shared by the PO pre-send checklist (`PoChecklistCard`) and the
 * order/PO stage checklist (`StageChecklist`), so the two features read as
 * one system rather than two similar-looking dialogs.
 */
import { useState } from 'react';
import { Alert, Input, Modal, Space, Typography } from 'antd';

const { Text } = Typography;

/** A sidestep with no stated why is the silent skip the checklist exists to stop. */
const MIN_REASON = 3;

export function SidestepReasonModal({
  label,
  onClose,
  onConfirm,
}: {
  /** The item/task being sidestepped, for the modal body; null closes it. */
  label: string | null;
  onClose: () => void;
  /** Resolves to an error message on failure, or null on success. */
  onConfirm: (reason: string) => Promise<string | null>;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function close() {
    setReason('');
    setError(null);
    onClose();
  }

  async function submit() {
    const trimmed = reason.trim();
    if (trimmed.length < MIN_REASON) {
      setError('Give a reason — at least a few words.');
      return;
    }
    setSaving(true);
    // The server is the enforcement (a must-do check refuses a sidestep with a
    // 409). Keep the modal open and say why, rather than closing on a change
    // that did not happen.
    const failure = await onConfirm(trimmed);
    setSaving(false);
    if (failure) {
      setError(failure);
      return;
    }
    close();
  }

  return (
    <Modal
      title="Sidestep this check"
      open={label !== null}
      onCancel={close}
      onOk={submit}
      okText="Record sidestep"
      confirmLoading={saving}
      destroyOnClose
    >
      {label && (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Text strong>{label}</Text>
          <Text type="secondary">
            This records the check as acknowledged rather than done, with your name and your
            reason against it. Anyone looking at this will see it was skipped deliberately and
            why.
          </Text>
          <Input.TextArea
            rows={3}
            value={reason}
            autoFocus
            maxLength={500}
            placeholder="Why is this being skipped? e.g. no fonts on this job"
            aria-label="Reason for sidestepping"
            onChange={(e) => {
              setReason(e.target.value);
              setError(null);
            }}
          />
          {error && <Alert type="error" message={error} showIcon />}
        </Space>
      )}
    </Modal>
  );
}
