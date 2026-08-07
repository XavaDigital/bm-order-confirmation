'use client';

/**
 * The staff half of the awaiting-approval FLAG (David, 2026-08-06): the factory
 * finished a phase and it is waiting on US.
 *
 * A banner, not a tag in a corner — this is the queue David works from, so a
 * flagged PO has to announce itself the moment the page opens. It renders
 * NOTHING when the flag is clear.
 *
 * Approving is one act with two optional halves: a comment the supplier sees,
 * and moving the status on ("approved, now do the next phase"). The move offers
 * only what `canTransition` allows from the CURRENT status — the same pure
 * function the service guards with — so the UI can never propose an illegal
 * move, and the default is the next step in the production chain.
 */
import { useEffect, useState } from 'react';
import { Alert, App, Button, Input, Modal, Select, Typography } from 'antd';
import { CheckOutlined, HourglassOutlined } from '@ant-design/icons';
import { PO_STATUSES, canTransition, type PoStatus } from '@/server/purchase-orders/contract';
import { poStatusMeta } from '@/lib/status';
import { formatDate } from '@/lib/format';
import { postJson } from '@/lib/api-fetch';

const { Text } = Typography;

/**
 * Statuses that may never be the DEFAULT of the "and move to…" picker, even
 * when they are legal:
 *  - `cancelled`/`remake` are not forward production steps — they are decisions
 *    someone makes deliberately, never something an Approve click should
 *    pre-select;
 *  - `confirmed` is legacy (the live flow goes Unconfirmed → Design prep), so
 *    defaulting to it would quietly park POs in a dead status.
 * All three stay SELECTABLE — this only governs what is pre-filled.
 */
const NEVER_DEFAULT: readonly PoStatus[] = ['cancelled', 'remake', 'confirmed'];

/** Statuses this PO may legally move to, in production-chain order. */
export function legalAdvanceTargets(current: string): PoStatus[] {
  return PO_STATUSES.filter((s) => canTransition(current as PoStatus, s));
}

/**
 * What the "and move to…" picker starts on: the next step in the chain if one
 * is legal, else nothing (a completed/cancelled PO has nowhere forward to go,
 * and approving it is still a legitimate act on its own).
 *
 * PO_STATUSES is declared in chain order, so the FIRST legal non-excluded entry
 * IS the next step — no second ordering to keep in sync with the contract.
 */
export function defaultAdvanceTo(current: string): PoStatus | null {
  return legalAdvanceTargets(current).find((s) => !NEVER_DEFAULT.includes(s)) ?? null;
}

interface Props {
  poId: string;
  /** Null = nothing is waiting on us; the banner renders nothing. */
  awaitingApprovalAt: string | null;
  /** Who submitted it, e.g. "Ana (Dynasty)". */
  awaitingApprovalBy: string | null;
  /** The status that was submitted — may differ from the current one. */
  awaitingApprovalStatus: string | null;
  /** What they said they were submitting. */
  awaitingApprovalNote: string | null;
  /** The PO's current status, which is what bounds the legal moves. */
  status: string;
  /** Re-read the PO once approved. */
  onApproved: () => void | Promise<void>;
}

export function PoApprovalBanner({
  poId,
  awaitingApprovalAt,
  awaitingApprovalBy,
  awaitingApprovalStatus,
  awaitingApprovalNote,
  status,
  onApproved,
}: Props) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [advanceTo, setAdvanceTo] = useState<PoStatus | null>(() => defaultAdvanceTo(status));
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The status can change under us (another tab, a board drag), and the default
  // is derived from it — re-seed rather than offering a stale suggestion.
  useEffect(() => {
    setAdvanceTo(defaultAdvanceTo(status));
  }, [status]);

  if (!awaitingApprovalAt) return null;

  const submittedStatus = awaitingApprovalStatus ?? status;
  const targets = legalAdvanceTargets(status);

  async function approve() {
    setApproving(true);
    setError(null);
    try {
      const res = await postJson<{ advancedTo: string | null }>(
        `/api/admin/purchase-orders/${poId}/approve`,
        { advanceTo, comment: comment.trim() || undefined },
        'Failed to approve',
      );
      setOpen(false);
      setComment('');
      message.success(
        res.advancedTo
          ? `Approved — moved to ${poStatusMeta(res.advancedTo).label}`
          : 'Approved — the supplier has been told',
      );
      await onApproved();
    } catch (err) {
      // 409s (not waiting for approval / illegal move) carry the server's own
      // wording; keep the modal open so it can be read and acted on.
      setError(err instanceof Error ? err.message : 'Failed to approve');
    } finally {
      setApproving(false);
    }
  }

  return (
    <>
      <Alert
        type="warning"
        showIcon
        icon={<HourglassOutlined />}
        data-testid="awaiting-approval-banner"
        style={{ marginBottom: 16 }}
        message={
          <Text strong>
            {`${awaitingApprovalBy ?? 'The supplier'} submitted ${poStatusMeta(submittedStatus).label} for approval on ${formatDate(awaitingApprovalAt)}`}
          </Text>
        }
        description={
          awaitingApprovalNote ? (
            <div style={{ whiteSpace: 'pre-wrap' }}>“{awaitingApprovalNote}”</div>
          ) : (
            <Text type="secondary">No note was left.</Text>
          )
        }
        action={
          <Button
            type="primary"
            icon={<CheckOutlined />}
            // Named apart from the modal's own OK button: antd folds the icon
            // into the accessible name, so without this the two read alike to
            // a screen reader ("check Approve" / "Approve").
            aria-label="Approve submission"
            onClick={() => setOpen(true)}
          >
            Approve
          </Button>
        }
      />

      <Modal
        title="Approve this submission"
        open={open}
        okText="Approve"
        confirmLoading={approving}
        onOk={() => void approve()}
        onCancel={() => {
          setOpen(false);
          setError(null);
        }}
      >
        {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          Clears the waiting flag and posts a comment the supplier can see.
        </Text>

        <Text strong style={{ display: 'block', marginBottom: 4 }}>
          Comment to the supplier
        </Text>
        <Input.TextArea
          rows={3}
          maxLength={2000}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Anything they should know before carrying on (optional)"
          aria-label="Comment to the supplier"
        />

        <Text strong style={{ display: 'block', margin: '16px 0 4px' }}>
          …and move to
        </Text>
        <Select<PoStatus | null>
          style={{ width: '100%' }}
          allowClear
          value={advanceTo}
          onChange={(v) => setAdvanceTo(v ?? null)}
          placeholder="Leave the status where it is"
          aria-label="and move to"
          options={targets.map((s) => ({ value: s, label: poStatusMeta(s).label }))}
          notFoundContent="Nowhere legal to move from here"
        />
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>
          Only moves that are legal from {poStatusMeta(status).label} are offered. Clear it to
          approve without moving the purchase order.
        </Text>
      </Modal>
    </>
  );
}
