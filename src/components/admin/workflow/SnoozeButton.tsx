'use client';

/**
 * Snooze the stuck-work nagging for one job, for the signed-in user only.
 *
 * Per-user by design (see `workflow_reminders`): on a shared board a global
 * snooze would let one person silence a job for everyone, which turns a nagging
 * system into a lying one. The API scopes every write to the session, so this
 * component never names whose snooze it is setting.
 */
import { useState } from 'react';
import { App, Button, Dropdown, Tooltip } from 'antd';
import { BellOutlined, ClockCircleOutlined } from '@ant-design/icons';
import { deleteJson, putJson } from '@/lib/api-fetch';

export type BoardKey = 'order' | 'purchase_order';

/** Mirrors SNOOZE_PRESETS on the server; kept short so the menu stays scannable. */
const PRESETS = [
  { key: '1d', label: 'Tomorrow', hours: 24 },
  { key: '2d', label: 'In 2 days', hours: 48 },
  { key: '1w', label: 'Next week', hours: 24 * 7 },
] as const;

interface Props {
  entityType: BoardKey;
  entityId: string;
  /** True when the signed-in user already has a live snooze on this job. */
  snoozed?: boolean;
  onChange?: () => void;
}

export function SnoozeButton({ entityType, entityId, snoozed = false, onChange }: Props) {
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);

  async function snooze(hours: number, label: string) {
    setBusy(true);
    try {
      await putJson(
        '/api/admin/workflow/reminders',
        {
          entityType,
          entityId,
          kind: 'snooze',
          dueAt: new Date(Date.now() + hours * 3_600_000).toISOString(),
        },
        'Failed to snooze',
      );
      message.success(`Snoozed until ${label.toLowerCase()}`);
      onChange?.();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to snooze');
    } finally {
      setBusy(false);
    }
  }

  async function unsnooze() {
    setBusy(true);
    try {
      await deleteJson(
        '/api/admin/workflow/reminders',
        { entityType, entityId, kind: 'snooze' },
        'Failed to clear the snooze',
      );
      message.success('Snooze cleared');
      onChange?.();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to clear the snooze');
    } finally {
      setBusy(false);
    }
  }

  if (snoozed) {
    return (
      <Tooltip title="You have snoozed reminders for this job">
        <Button
          size="small"
          icon={<BellOutlined />}
          loading={busy}
          onClick={() => void unsnooze()}
        >
          Snoozed
        </Button>
      </Tooltip>
    );
  }

  return (
    <Dropdown
      disabled={busy}
      menu={{
        items: PRESETS.map((preset) => ({ key: preset.key, label: preset.label })),
        onClick: ({ key }) => {
          const preset = PRESETS.find((p) => p.key === key);
          if (preset) void snooze(preset.hours, preset.label);
        },
      }}
    >
      <Button size="small" icon={<ClockCircleOutlined />} loading={busy}>
        Snooze
      </Button>
    </Dropdown>
  );
}
