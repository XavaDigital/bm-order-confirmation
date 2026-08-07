'use client';

/**
 * "The customer hasn't seen these changes" (David, 2026-08-07).
 *
 * The failure this prevents is quiet: an order is edited after it was agreed,
 * nobody notices, and it goes to the factory on a version the customer never
 * saw. So the banner is loud, and it LISTS what changed rather than saying
 * "this order has changed" — a warning nobody can act on gets dismissed.
 *
 * David's ruling: the system detects and flags, staff decide whether to re-ask
 * ("sometimes you've already phoned them"). Nothing here asks on its own.
 */
import { useCallback, useEffect, useState } from 'react';
import { Alert, App, Button, Checkbox, Input, List, Modal, Space, Tag, Typography } from 'antd';
import { ClockCircleOutlined, SendOutlined } from '@ant-design/icons';
import { deleteJson, getJson, postJson } from '@/lib/api-fetch';

const { Text } = Typography;

export interface OrderChange {
  key: string;
  severity: 'material' | 'minor';
  label: string;
}

export interface ReconfirmationState {
  status: 'not_confirmed' | 'in_sync' | 'minor_changes' | 'drifted' | 'awaiting_customer';
  changes: OrderChange[];
  hasMaterialChanges: boolean;
  confirmedRevision: number | null;
  requestedAt: string | null;
  requestedBy: string | null;
  requestedNote: string | null;
}

/** Changes worth naming first — the ones that hold the job. */
function ordered(changes: OrderChange[]): OrderChange[] {
  return [...changes].sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === 'material' ? -1 : 1,
  );
}

const STATUSES: ReadonlyArray<ReconfirmationState['status']> = [
  'not_confirmed',
  'in_sync',
  'minor_changes',
  'drifted',
  'awaiting_customer',
];

/**
 * Trust nothing from the wire. This banner sits ABOVE the whole order page, so
 * a response that is not the shape expected — an older deployment, a proxy
 * error page, a stubbed fetch — must make the banner disappear, never take the
 * order page down with it.
 */
function asState(value: unknown): ReconfirmationState | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<ReconfirmationState>;
  if (!STATUSES.includes(raw.status as ReconfirmationState['status'])) return null;
  const changes = Array.isArray(raw.changes)
    ? raw.changes.filter(
        (c): c is OrderChange =>
          Boolean(c) && typeof (c as OrderChange).label === 'string',
      )
    : [];
  return {
    status: raw.status as ReconfirmationState['status'],
    changes,
    hasMaterialChanges: changes.some((c) => c.severity === 'material'),
    confirmedRevision: raw.confirmedRevision ?? null,
    requestedAt: raw.requestedAt ?? null,
    requestedBy: raw.requestedBy ?? null,
    requestedNote: raw.requestedNote ?? null,
  };
}

export function ChangeList({ changes }: { changes?: OrderChange[] }) {
  if (!Array.isArray(changes) || changes.length === 0) return null;
  return (
    <List
      size="small"
      dataSource={ordered(changes)}
      style={{ marginTop: 8 }}
      renderItem={(change) => (
        <List.Item style={{ paddingInline: 0, borderBlockEnd: 'none', paddingBlock: 2 }}>
          <Space size={8} align="start">
            {change.severity === 'material' ? (
              <Tag color="warning" style={{ marginInlineEnd: 0 }}>
                Needs agreeing
              </Tag>
            ) : (
              <Tag style={{ marginInlineEnd: 0 }}>Minor</Tag>
            )}
            <Text>{change.label}</Text>
          </Space>
        </List.Item>
      )}
    />
  );
}

export function ReconfirmationBanner({
  orderId,
  canMutate,
  onChanged,
}: {
  orderId: string;
  canMutate: boolean;
  /** Let the page refresh anything that depends on the flag (the PO checklist). */
  onChanged?: () => void;
}) {
  const { message } = App.useApp();
  const [state, setState] = useState<ReconfirmationState | null>(null);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');
  const [sendEmail, setSendEmail] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setState(
        asState(
          await getJson<unknown>(
            `/api/admin/orders/${orderId}/reconfirm`,
            'Failed to check the confirmation',
          ),
        ),
      );
    } catch {
      // A failed check must not break the order page — the banner simply does
      // not render, and everything else on the page still works.
      setState(null);
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit() {
    setSaving(true);
    try {
      const result = await postJson<{ emailSent?: boolean; emailError?: string }>(
        `/api/admin/orders/${orderId}/reconfirm`,
        { note: note.trim() || null, sendEmail },
        'Failed to ask for re-confirmation',
      );
      setState(asState(result));
      setAsking(false);
      setNote('');
      if (result.emailError) {
        // The flag IS raised and production IS held; only the email failed.
        message.warning(`Asked, but the email failed: ${result.emailError}`);
      } else if (result.emailSent) {
        message.success('Asked the customer to confirm again');
      } else {
        message.success('Marked as waiting for the customer');
      }
      onChanged?.();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to ask for re-confirmation');
    } finally {
      setSaving(false);
    }
  }

  async function withdraw() {
    setSaving(true);
    try {
      setState(
        asState(
          await deleteJson<unknown>(
            `/api/admin/orders/${orderId}/reconfirm`,
            'Failed to withdraw the request',
          ),
        ),
      );
      message.success('Request withdrawn');
      onChanged?.();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to withdraw the request');
    } finally {
      setSaving(false);
    }
  }

  // Nothing to say about an order nobody has confirmed, or one that matches.
  if (!state || state.status === 'not_confirmed' || state.status === 'in_sync') return null;

  const askButton = canMutate && (
    <Button
      size="small"
      type="primary"
      icon={<SendOutlined />}
      onClick={() => setAsking(true)}
      data-testid="ask-reconfirm"
    >
      Ask customer to confirm again
    </Button>
  );

  return (
    <>
      {state.status === 'awaiting_customer' ? (
        <Alert
          type="info"
          showIcon
          icon={<ClockCircleOutlined />}
          style={{ marginBottom: 16 }}
          message="Waiting for the customer to confirm again"
          description={
            <>
              <Text type="secondary">
                Asked{state.requestedBy ? ` by ${state.requestedBy}` : ''}. Purchase orders for this
                job are held until they confirm — you can sidestep that check with a reason if you
                need to send anyway.
              </Text>
              {state.requestedNote && (
                <div style={{ marginTop: 8 }}>
                  <Text type="secondary">Note sent: </Text>
                  <Text italic>{state.requestedNote}</Text>
                </div>
              )}
              <ChangeList changes={state.changes} />
            </>
          }
          action={
            canMutate && (
              <Space direction="vertical">
                <Button size="small" onClick={() => void withdraw()} loading={saving}>
                  They already agreed
                </Button>
              </Space>
            )
          }
        />
      ) : (
        <Alert
          type={state.hasMaterialChanges ? 'warning' : 'info'}
          showIcon
          style={{ marginBottom: 16 }}
          message={
            state.hasMaterialChanges
              ? 'This order has changed since the customer confirmed it'
              : 'Small changes since the customer confirmed'
          }
          description={
            <>
              <Text type="secondary">
                {state.hasMaterialChanges
                  ? 'They have not agreed to this version. Purchase orders for this job are held until they do.'
                  : 'Nothing here changes what is being made, so nothing is held. Re-ask only if you want to.'}
              </Text>
              <ChangeList changes={state.changes} />
            </>
          }
          action={askButton ? <Space direction="vertical">{askButton}</Space> : undefined}
        />
      )}

      <Modal
        title="Ask the customer to confirm again"
        open={asking}
        onCancel={() => setAsking(false)}
        onOk={() => void submit()}
        okText="Ask to confirm"
        confirmLoading={saving}
        destroyOnClose
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Text type="secondary">
            They will see the order as it stands now, with a list of what changed. Nothing goes into
            production until they confirm.
          </Text>
          <ChangeList changes={state.changes} />
          <Input.TextArea
            rows={3}
            value={note}
            maxLength={1000}
            aria-label="Note to the customer"
            placeholder="Optional note — e.g. we added the four larges you asked for on the phone"
            onChange={(e) => setNote(e.target.value)}
          />
          <Checkbox checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)}>
            Email them the link now
          </Checkbox>
        </Space>
      </Modal>
    </>
  );
}
