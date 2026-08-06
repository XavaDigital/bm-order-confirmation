'use client';

/**
 * Conditional reminders: a note attached to THIS order/PO that fires the
 * moment it reaches a chosen status — e.g. "when this PO hits Test print,
 * remind me to send the customer a proof for approval."
 *
 * Distinct from the personal snooze/reminder (`SnoozeButton.tsx`), which
 * fires on a calendar due-date. These fire event-driven, off the status
 * transition itself (`server/workflow/status-reminders.ts`).
 */
import { useCallback, useEffect, useState } from 'react';
import { App, Button, Card, Empty, Input, Select, Skeleton, Space, Tag, Typography } from 'antd';
import { BellOutlined, CloseOutlined, PlusOutlined } from '@ant-design/icons';
import { deleteJson, getJson, postJson } from '@/lib/api-fetch';
import { ORDER_STATUS, PO_STATUS } from '@/lib/status';

export type BoardKey = 'order' | 'purchase_order';

interface StatusReminder {
  id: string;
  triggerStatus: string;
  note: string;
  createdByStaffUserId: string;
  firedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

interface Props {
  boardKey: BoardKey;
  entityId: string;
}

function statusOptions(boardKey: BoardKey) {
  const meta = boardKey === 'order' ? ORDER_STATUS : PO_STATUS;
  return Object.entries(meta).map(([value, m]) => ({ value, label: m.label }));
}

function statusLabel(boardKey: BoardKey, status: string): string {
  const meta = boardKey === 'order' ? ORDER_STATUS : PO_STATUS;
  return (meta as Record<string, { label: string }>)[status]?.label ?? status;
}

export function ConditionalReminders({ boardKey, entityId }: Props) {
  const { message } = App.useApp();
  const [reminders, setReminders] = useState<StatusReminder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [targetStatus, setTargetStatus] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try {
      const next = await getJson<StatusReminder[]>(
        `/api/admin/workflow/status-reminders?boardKey=${boardKey}&entityId=${encodeURIComponent(entityId)}`,
        'Failed to load reminders',
      );
      setReminders(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load reminders');
    }
  }, [boardKey, entityId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit() {
    if (!targetStatus || !note.trim()) return;
    setBusy(true);
    try {
      await postJson(
        '/api/admin/workflow/status-reminders',
        { boardKey, entityId, triggerStatus: targetStatus, note: note.trim() },
        'Failed to set the reminder',
      );
      message.success('Reminder set');
      setNote('');
      setTargetStatus(null);
      setAdding(false);
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to set the reminder');
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    setBusy(true);
    try {
      await deleteJson('/api/admin/workflow/status-reminders', { id }, 'Failed to cancel the reminder');
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to cancel the reminder');
    } finally {
      setBusy(false);
    }
  }

  if (reminders === null && error === null) return <Skeleton active paragraph={{ rows: 2 }} />;

  const pending = (reminders ?? []).filter((r) => !r.resolvedAt);
  const fired = (reminders ?? []).filter((r) => r.firedAt);

  return (
    <Space direction="vertical" size={10} style={{ width: '100%' }}>
      <Space size={8} wrap align="center">
        <Typography.Text strong>Conditional reminders</Typography.Text>
        {!adding && (
          <Button size="small" icon={<PlusOutlined />} onClick={() => setAdding(true)}>
            Add
          </Button>
        )}
      </Space>

      {error && <Typography.Text type="danger">{error}</Typography.Text>}

      {adding && (
        <Card size="small" styles={{ body: { padding: 12 } }}>
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Select
              placeholder="When status becomes…"
              style={{ width: '100%' }}
              value={targetStatus}
              onChange={setTargetStatus}
              options={statusOptions(boardKey)}
            />
            <Input
              placeholder="e.g. Send customer a test print for approval"
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
              onPressEnter={() => void submit()}
            />
            <Space>
              <Button
                type="primary"
                size="small"
                loading={busy}
                disabled={!targetStatus || !note.trim()}
                onClick={() => void submit()}
              >
                Save
              </Button>
              <Button size="small" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </Space>
          </Space>
        </Card>
      )}

      {pending.length === 0 && fired.length === 0 && !adding && (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No conditional reminders set"
        />
      )}

      {pending.map((r) => (
        <Card key={r.id} size="small" styles={{ body: { padding: '8px 12px' } }}>
          <Space size={8} align="start" style={{ width: '100%' }}>
            <BellOutlined style={{ marginTop: 4, color: '#faad14' }} />
            <div style={{ flex: 1 }}>
              <Space size={6} wrap>
                <Tag color="gold">When {statusLabel(boardKey, r.triggerStatus)}</Tag>
              </Space>
              <div>{r.note}</div>
            </div>
            {/* Shown to any staff viewer; the server enforces creator-or-admin
                (mirrors the accepted affordance-hiding gap noted in CLAUDE.md —
                a non-owner sees a friendly toast on 403 rather than the button
                being hidden). */}
            <Button
              type="text"
              size="small"
              icon={<CloseOutlined />}
              aria-label={`Cancel reminder: ${r.note}`}
              loading={busy}
              onClick={() => void cancel(r.id)}
            />
          </Space>
        </Card>
      ))}

      {fired.length > 0 && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {fired.length} fired previously
        </Typography.Text>
      )}
    </Space>
  );
}
