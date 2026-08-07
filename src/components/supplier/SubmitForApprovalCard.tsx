'use client';

/**
 * "This phase is done — please approve it" (David, 2026-08-06), the supplier
 * half of the awaiting-approval FLAG.
 *
 * Two mutually exclusive faces, never both:
 *  - NOT waiting: a prominent primary button opening a small modal for an
 *    optional note ("What are you submitting?").
 *  - WAITING: the button is GONE and an amber panel takes its place, saying
 *    when it was submitted and repeating the note. David's requirement was
 *    that it "should be obvious when they've uploaded something and then
 *    they're waiting for our approval" — a disabled button would read as a
 *    fault, so the button does not survive the submission.
 *
 * The status deliberately does not move: what changed is whose court the ball
 * is in, so nothing here touches the status actions beside it.
 *
 * The 409 (a finished PO has nothing left to approve) is shown INSIDE the modal
 * and the modal stays open — it explains why the button did nothing, and a
 * toast would be gone before it was read.
 */
import { useState } from 'react';
import { Alert, Button, Input, Modal, Typography } from 'antd';
import { CheckCircleOutlined, HourglassOutlined } from '@ant-design/icons';
import { ApiError, postJson } from '@/lib/api-fetch';
import { formatDate } from '@/lib/format';

const { Text } = Typography;

interface Props {
  /** Supplier portal code — the /supplier/[code] segment. */
  code: string;
  poNumber: string;
  /** Set = already submitted and waiting on BeastMode. */
  awaitingApprovalAt: string | null;
  /** What they said they were submitting, if anything. */
  awaitingApprovalNote: string | null;
  /** Re-read the PO so the waiting panel appears with server truth. */
  onSubmitted: () => void | Promise<void>;
  /** The portal cookie expired mid-action — the page swaps in the login card. */
  onUnauthorized?: () => void;
}

export function SubmitForApprovalCard({
  code,
  poNumber,
  awaitingApprovalAt,
  awaitingApprovalNote,
  onSubmitted,
  onUnauthorized,
}: Props) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      await postJson(
        `/api/supplier/${encodeURIComponent(code)}/po/${encodeURIComponent(poNumber)}/submit-approval`,
        note.trim() ? { note: note.trim() } : {},
        'Failed to submit for approval',
      );
      setOpen(false);
      setNote('');
      await onSubmitted();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onUnauthorized?.();
        setOpen(false);
        return;
      }
      // The 409 carries the server's own explanation ("nothing left to
      // approve") — show it verbatim rather than inventing a second wording.
      setError(err instanceof Error ? err.message : 'Failed to submit for approval');
    } finally {
      setSubmitting(false);
    }
  }

  if (awaitingApprovalAt) {
    return (
      <div style={{ marginTop: 20 }} data-testid="awaiting-approval-panel">
        <Alert
          type="warning"
          showIcon
          icon={<HourglassOutlined />}
          style={{
            background: 'rgba(250,173,20,0.12)',
            border: '1px solid rgba(250,173,20,0.45)',
          }}
          message={
            <Text strong style={{ color: 'rgba(255,255,255,0.95)' }}>
              {`Submitted for approval on ${formatDate(awaitingApprovalAt)} — waiting for BeastMode`}
            </Text>
          }
          description={
            <div style={{ color: 'rgba(255,255,255,0.75)' }}>
              {awaitingApprovalNote && (
                <div style={{ whiteSpace: 'pre-wrap', marginBottom: 6 }}>
                  “{awaitingApprovalNote}”
                </div>
              )}
              <div>
                Nothing to do here — we will review it and let you know in the comments when
                you can carry on.
              </div>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div style={{ marginTop: 20 }}>
      <Button
        type="primary"
        size="large"
        icon={<CheckCircleOutlined />}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        Submit for approval
      </Button>
      <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12, display: 'block', marginTop: 6 }}>
        Finished this phase? Tell us it is ready and we will approve it before you carry on.
      </Text>

      <Modal
        title="Submit for approval"
        open={open}
        okText="Submit for approval"
        confirmLoading={submitting}
        onOk={() => void submit()}
        onCancel={() => {
          setOpen(false);
          setError(null);
        }}
      >
        {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          We will be told this purchase order is waiting on us. Its status stays where it is
          until we approve.
        </Text>
        <Input.TextArea
          rows={3}
          maxLength={500}
          showCount
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What are you submitting? (optional)"
          aria-label="What are you submitting?"
        />
      </Modal>
    </div>
  );
}
