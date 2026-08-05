'use client';

import { Typography } from 'antd';
import type { RosterNameListEntry } from '@/types/customer';

const { Text } = Typography;

export interface NameListPreviewProps {
  entries: RosterNameListEntry[];
  /** Row count set by the manager — columns are derived, never stored. */
  rows: number | null;
}

/**
 * Live grid preview of how the name list will print — draft entries and row
 * count in, a dark panel of cells out, filled left-to-right/top-to-bottom
 * (CSS Grid's natural DOM order already does this, no manual placement
 * needed). Columns are ceil(count / rows) per GOT_YOUR_BACK_PLAN.md, not
 * stored — recomputed here from whatever's currently in the draft.
 */
export function NameListPreview({ entries, rows }: NameListPreviewProps) {
  const named = entries.filter((e) => e.name.trim());
  if (named.length === 0) return null;

  const effectiveRows = rows && rows > 0 ? rows : 1;
  const columns = Math.max(1, Math.ceil(named.length / effectiveRows));

  return (
    <div style={{ marginTop: 4 }}>
      <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, display: 'block', marginBottom: 8 }}>
        Preview — {named.length} name{named.length === 1 ? '' : 's'}, {effectiveRows} row
        {effectiveRows === 1 ? '' : 's'} × {columns} column{columns === 1 ? '' : 's'}
      </Text>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gap: 6,
          padding: 16,
          borderRadius: 8,
          background: '#141414',
          border: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        {named.map((entry, i) => (
          <div
            key={entry.id || `preview-${i}`}
            style={{
              padding: '8px 10px',
              borderRadius: 4,
              background: 'rgba(255,255,255,0.04)',
              textAlign: 'center',
              overflow: 'hidden',
            }}
          >
            <Text
              style={{ color: '#fff', fontSize: 13, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {entry.name}
            </Text>
            {entry.playerNumber && (
              <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>#{entry.playerNumber}</Text>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
