'use client';

/**
 * Pre-send checklist card (David, 2026-08-06) — the PO page's right-rail view
 * of GET /api/admin/purchase-orders/[id]/checklist. Auto-satisfied items
 * render checked + disabled with an "auto" tag (data satisfies them, nobody
 * ticks them); manual items toggle via POST and show who/when once ticked.
 * Unsatisfied items stand out — they are exactly what blocks the send.
 *
 * SIDESTEP (David, 2026-08-06): some checks may be acknowledged past instead of
 * done. That is a different fact from "done", so it looks different — amber, its
 * own tag, and the stated reason with the name of whoever gave it, on the card
 * rather than buried in the audit trail. Checks configured without
 * `allowSidestep` show no such affordance at all: for those, the only way past
 * is to do them.
 *
 * Follows the PoFilesCard split: `usePoChecklist` owns the data so the PAGE
 * can also read the items (the Send button's tooltip hints at outstanding
 * items from the same load — the server stays the enforcement).
 */
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Checkbox, Input, Modal, Space, Tag, Tooltip, Typography } from 'antd';
import { getJson, postJson } from '@/lib/api-fetch';
import { formatDate } from '@/lib/format';

const { Text } = Typography;

/** A sidestep with no stated why is the silent skip the checklist exists to stop. */
const MIN_REASON = 3;

export interface PoChecklistItem {
  id: string;
  label: string;
  autoRule: string | null;
  satisfied: boolean;
  /** True when `satisfied` came from the auto rule rather than a tick. */
  auto: boolean;
  /** May this check be acknowledged past instead of done? */
  allowSidestep: boolean;
  /** True when what satisfies it is an acknowledgement, not a tick. */
  sidestepped: boolean;
  sidestepReason: string | null;
  checkedByEmail: string | null;
  checkedAt: string | null;
}

/** What the page hands the card — resolves to an error message, or null on success. */
export type ChecklistToggle = (
  itemId: string,
  checked: boolean,
  sidestepReason?: string,
) => Promise<string | null> | void;

export function usePoChecklist(poId: string): {
  /** null until the first load answers; [] = no active items configured. */
  items: PoChecklistItem[] | null;
  loadError: boolean;
  reload: () => Promise<void>;
  /** Tick/untick/sidestep one manual item; resolves to the error message on failure. */
  toggle: (itemId: string, checked: boolean, sidestepReason?: string) => Promise<string | null>;
} {
  const [items, setItems] = useState<PoChecklistItem[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  const reload = useCallback(async () => {
    try {
      const data = await getJson<{ items: PoChecklistItem[] }>(
        `/api/admin/purchase-orders/${poId}/checklist`,
        'Failed to load the checklist',
      );
      setItems(data.items);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [poId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const toggle = useCallback(
    async (itemId: string, checked: boolean, sidestepReason?: string) => {
      try {
        const data = await postJson<{ items: PoChecklistItem[] }>(
          `/api/admin/purchase-orders/${poId}/checklist`,
          { itemId, checked, ...(sidestepReason && { sidestepReason }) },
          'Failed to update the checklist',
        );
        setItems(data.items);
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : 'Failed to update the checklist';
      }
    },
    [poId],
  );

  return { items, loadError, reload, toggle };
}

/**
 * The subtext under an item: who satisfied it, when, and — for a sidestep —
 * why. The reason is on the card and not only in the history, because the next
 * person to look at this PO is the one who needs to see it.
 */
function attribution(item: PoChecklistItem): string | null {
  const when = item.checkedAt ? formatDate(item.checkedAt) : null;
  if (item.sidestepped) {
    const who = item.checkedByEmail ?? 'someone';
    return [`Sidestepped by ${who}`, item.sidestepReason ? `"${item.sidestepReason}"` : null, when]
      .filter(Boolean)
      .join(' — ');
  }
  if (!item.checkedByEmail && !when) return null;
  return [item.checkedByEmail, when].filter(Boolean).join(' — ');
}

export function PoChecklistCard({
  items,
  loadError,
  onToggle,
}: {
  items: PoChecklistItem[] | null;
  loadError: boolean;
  onToggle: ChecklistToggle;
}) {
  const [sidestepping, setSidestepping] = useState<PoChecklistItem | null>(null);

  const done = (items ?? []).filter((i) => i.satisfied).length;
  const sidestepped = (items ?? []).filter((i) => i.sidestepped).length;
  const total = items?.length ?? 0;
  const complete = total > 0 && done === total;

  return (
    <Card title="Pre-send checklist" size="small" styles={{ header: { fontSize: 16, fontWeight: 600 } }}>
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        {loadError && !items && <Text type="secondary">Failed to load the checklist.</Text>}
        {items && total === 0 && <Text type="secondary">No checklist items configured.</Text>}
        {items && total > 0 && (
          <>
            {/* Compact progress line — green only when everything was actually
                DONE; a sidestep is counted separately, not hidden in the total. */}
            <Text
              strong
              type={complete && sidestepped === 0 ? 'success' : 'warning'}
              style={{ fontSize: 12 }}
              data-testid="checklist-progress"
            >
              {done} of {total} complete
              {sidestepped > 0 && ` · ${sidestepped} sidestepped`}
            </Text>
            {items.map((item) => {
              const subtext = !item.auto && item.satisfied ? attribution(item) : null;
              // Only offer the acknowledgement where it is configured, and only
              // while the check is still outstanding.
              const canSidestep = item.allowSidestep && !item.auto && !item.satisfied;
              return (
                <div key={item.id} data-testid={`checklist-item-${item.id}`}>
                  <Checkbox
                    checked={item.satisfied}
                    // Auto items satisfy themselves from data — nothing to tick.
                    disabled={item.auto}
                    onChange={(e) => onToggle(item.id, e.target.checked)}
                  >
                    {/* Outstanding items stand out (they block the send), and so
                        does a sidestep — it is not the same fact as a tick. */}
                    <Text
                      strong={!item.satisfied}
                      type={item.satisfied && !item.sidestepped ? undefined : 'warning'}
                    >
                      {item.label}
                    </Text>
                    {item.auto && (
                      <Tooltip title="Satisfied automatically from the purchase order's data">
                        <Tag style={{ marginInlineStart: 6, marginInlineEnd: 0 }}>auto</Tag>
                      </Tooltip>
                    )}
                    {item.sidestepped && (
                      <Tooltip title="Acknowledged as not done, with a reason on record">
                        <Tag color="warning" style={{ marginInlineStart: 6, marginInlineEnd: 0 }}>
                          Sidestepped
                        </Tag>
                      </Tooltip>
                    )}
                  </Checkbox>
                  {canSidestep && (
                    <Button
                      type="link"
                      size="small"
                      style={{ paddingInline: 4, height: 'auto' }}
                      onClick={() => setSidestepping(item)}
                    >
                      Sidestep
                    </Button>
                  )}
                  {subtext && (
                    <Text
                      type={item.sidestepped ? 'warning' : 'secondary'}
                      style={{ fontSize: 12, display: 'block', marginInlineStart: 24 }}
                    >
                      {subtext}
                    </Text>
                  )}
                </div>
              );
            })}
            {!complete && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                Sending is blocked until every item is complete.
              </Text>
            )}
          </>
        )}
      </Space>

      <SidestepModal
        item={sidestepping}
        onClose={() => setSidestepping(null)}
        onConfirm={onToggle}
      />
    </Card>
  );
}

/**
 * The acknowledgement itself. It asks for a reason and says plainly what is
 * being recorded — this is the moment someone decides a check will not be done,
 * and it should read like a decision, not a dismissal.
 */
function SidestepModal({
  item,
  onClose,
  onConfirm,
}: {
  item: PoChecklistItem | null;
  onClose: () => void;
  onConfirm: ChecklistToggle;
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
    if (!item) return;
    const trimmed = reason.trim();
    if (trimmed.length < MIN_REASON) {
      setError('Give a reason — at least a few words.');
      return;
    }
    setSaving(true);
    // The server refuses a sidestep on a must-do check (409). Keep the modal
    // open and say why, rather than closing on a change that did not happen.
    const failure = await onConfirm(item.id, true, trimmed);
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
      open={item !== null}
      onCancel={close}
      onOk={submit}
      okText="Record sidestep"
      confirmLoading={saving}
      destroyOnClose
    >
      {item && (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Text strong>{item.label}</Text>
          <Text type="secondary">
            This records the check as acknowledged rather than done, with your name and your
            reason against it. Anyone looking at this purchase order will see it was skipped
            deliberately and why.
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
