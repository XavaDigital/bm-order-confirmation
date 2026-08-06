'use client';

/**
 * Pre-send checklist card (David, 2026-08-06) — the PO page's right-rail view
 * of GET /api/admin/purchase-orders/[id]/checklist. Auto-satisfied items
 * render checked + disabled with an "auto" tag (data satisfies them, nobody
 * ticks them); manual items toggle via POST and show who/when once ticked.
 * Unsatisfied items stand out — they are exactly what blocks the send.
 *
 * Follows the PoFilesCard split: `usePoChecklist` owns the data so the PAGE
 * can also read the items (the Send button's tooltip hints at outstanding
 * items from the same load — the server stays the enforcement).
 */
import { useCallback, useEffect, useState } from 'react';
import { Card, Checkbox, Space, Tag, Tooltip, Typography } from 'antd';
import { getJson, postJson } from '@/lib/api-fetch';
import { formatDate } from '@/lib/format';

const { Text } = Typography;

export interface PoChecklistItem {
  id: string;
  label: string;
  autoRule: string | null;
  satisfied: boolean;
  /** True when `satisfied` came from the auto rule rather than a tick. */
  auto: boolean;
  checkedByEmail: string | null;
  checkedAt: string | null;
}

export function usePoChecklist(poId: string): {
  /** null until the first load answers; [] = no active items configured. */
  items: PoChecklistItem[] | null;
  loadError: boolean;
  reload: () => Promise<void>;
  /** Tick/untick one manual item; resolves to the error message on failure. */
  toggle: (itemId: string, checked: boolean) => Promise<string | null>;
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
    async (itemId: string, checked: boolean) => {
      try {
        const data = await postJson<{ items: PoChecklistItem[] }>(
          `/api/admin/purchase-orders/${poId}/checklist`,
          { itemId, checked },
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

/** "who — when" subtext for a manually ticked item, e.g. "ana@x.com — 6 Aug 2026". */
function tickAttribution(item: PoChecklistItem): string | null {
  if (!item.checkedByEmail && !item.checkedAt) return null;
  return [item.checkedByEmail, item.checkedAt ? formatDate(item.checkedAt) : null]
    .filter(Boolean)
    .join(' — ');
}

export function PoChecklistCard({
  items,
  loadError,
  onToggle,
}: {
  items: PoChecklistItem[] | null;
  loadError: boolean;
  onToggle: (itemId: string, checked: boolean) => void;
}) {
  const done = (items ?? []).filter((i) => i.satisfied).length;
  const total = items?.length ?? 0;
  const complete = total > 0 && done === total;

  return (
    <Card title="Pre-send checklist" size="small" styles={{ header: { fontSize: 16, fontWeight: 600 } }}>
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        {loadError && !items && <Text type="secondary">Failed to load the checklist.</Text>}
        {items && total === 0 && <Text type="secondary">No checklist items configured.</Text>}
        {items && total > 0 && (
          <>
            {/* Compact progress line — green once everything is satisfied. */}
            <Text
              strong
              type={complete ? 'success' : 'warning'}
              style={{ fontSize: 12 }}
              data-testid="checklist-progress"
            >
              {done} of {total} complete
            </Text>
            {items.map((item) => {
              const attribution = !item.auto && item.satisfied ? tickAttribution(item) : null;
              return (
                <div key={item.id}>
                  <Checkbox
                    checked={item.satisfied}
                    // Auto items satisfy themselves from data — nothing to tick.
                    disabled={item.auto}
                    onChange={(e) => onToggle(item.id, e.target.checked)}
                  >
                    {/* Unsatisfied items stand out — they block the send. */}
                    <Text strong={!item.satisfied} type={item.satisfied ? undefined : 'warning'}>
                      {item.label}
                    </Text>
                    {item.auto && (
                      <Tooltip title="Satisfied automatically from the purchase order's data">
                        <Tag style={{ marginInlineStart: 6, marginInlineEnd: 0 }}>auto</Tag>
                      </Tooltip>
                    )}
                  </Checkbox>
                  {attribution && (
                    <Text
                      type="secondary"
                      style={{ fontSize: 12, display: 'block', marginInlineStart: 24 }}
                    >
                      {attribution}
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
    </Card>
  );
}
