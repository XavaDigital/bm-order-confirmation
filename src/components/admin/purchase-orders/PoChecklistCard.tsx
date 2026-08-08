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
import { Button, Card, Checkbox, Space, Tag, Tooltip, Typography } from 'antd';
import { getJson, postJson } from '@/lib/api-fetch';
import { formatDate } from '@/lib/format';
import { SidestepReasonModal } from '@/components/admin/SidestepReasonModal';

const { Text } = Typography;

export interface PoChecklistItem {
  id: string;
  label: string;
  /** The longer explanation under the title (David, 2026-08-08). */
  description?: string | null;
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
 * Red outstanding, green done, orange sidestepped (David, 2026-08-08).
 *
 * Three states, three colours, everywhere the item is drawn — the label, the
 * tag and the attribution line all read from here so they cannot drift apart
 * and leave a green tick over an orange note. Orange for a sidestep is the
 * point: it is satisfied, but not the same fact as done, and it should not look
 * identical to work that actually happened.
 */
type ItemTone = 'danger' | 'success' | 'warning';

export function itemTone(item: { satisfied: boolean; sidestepped: boolean }): ItemTone {
  if (item.sidestepped) return 'warning';
  return item.satisfied ? 'success' : 'danger';
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
            {/* Compact progress line, on the same three-colour scheme as the
                items: red while anything is outstanding (it blocks the send),
                orange when everything is satisfied but some of it was
                sidestepped, green only when it was all actually DONE. */}
            <Text
              strong
              type={!complete ? 'danger' : sidestepped > 0 ? 'warning' : 'success'}
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
              const tone = itemTone(item);
              return (
                <div key={item.id} data-testid={`checklist-item-${item.id}`}>
                  <Checkbox
                    checked={item.satisfied}
                    // Auto items satisfy themselves from data — nothing to tick.
                    disabled={item.auto}
                    onChange={(e) => onToggle(item.id, e.target.checked)}
                  >
                    <Text strong={!item.satisfied} type={tone}>
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
                  {/* The explanation sits under the title, in the quiet tone,
                      so the list can be scanned by title alone and read in full
                      only where it matters (David, 2026-08-08). */}
                  {item.description && (
                    <Text
                      type="secondary"
                      style={{ fontSize: 12, display: 'block', marginInlineStart: 24 }}
                    >
                      {item.description}
                    </Text>
                  )}
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
                      data-testid={`checklist-subtext-${item.id}`}
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

      <SidestepReasonModal
        label={sidestepping?.label ?? null}
        onClose={() => setSidestepping(null)}
        onConfirm={async (reason) => {
          if (!sidestepping) return null;
          const failure = await onToggle(sidestepping.id, true, reason);
          return failure ?? null;
        }}
      />
    </Card>
  );
}
