'use client';

/**
 * Compact presentational rendering of a PO variance (live order vs. the
 * latest revision snapshot — see detectVariance in
 * src/server/purchase-orders/snapshot.ts). Used inside the detail page's
 * expandable variance banner. Green = added, orange = modified, red = removed.
 */
import { Typography } from 'antd';
import { SEMANTIC } from '@/lib/semantic-colors';
import type {
  PoFieldChange,
  PoVariance,
  PoVarianceLine,
} from '@/server/purchase-orders/snapshot';

const { Text } = Typography;

const CHANGE_COLOR: Record<PoVarianceLine['change'], string> = {
  added: SEMANTIC.success,
  modified: SEMANTIC.warning,
  removed: SEMANTIC.error,
};

const CHANGE_LABEL: Record<PoVarianceLine['change'], string> = {
  added: 'Added',
  modified: 'Modified',
  removed: 'Removed',
};

function fmtValue(v: unknown): string {
  if (v == null || v === '') return '—';
  if (Array.isArray(v)) return v.length > 0 ? v.map(String).join(', ') : '—';
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>).filter(([, val]) => val);
    return entries.length > 0 ? entries.map(([k, val]) => `${k}: ${String(val)}`).join(', ') : '—';
  }
  return String(v);
}

function FieldChangeLine({ change }: { change: PoFieldChange }) {
  return (
    <div style={{ fontSize: 12, lineHeight: '20px' }}>
      <Text type="secondary">{change.field}: </Text>
      <Text delete type="secondary">
        {fmtValue(change.from)}
      </Text>
      <Text type="secondary"> → </Text>
      <Text style={{ color: SEMANTIC.warning }}>{fmtValue(change.to)}</Text>
    </div>
  );
}

function describeLine(line: PoVarianceLine): string {
  const parts = [
    line.line.size ?? '(no size)',
    line.line.playerName,
    line.line.playerNumber ? `#${line.line.playerNumber}` : null,
  ].filter(Boolean);
  return parts.join(' · ');
}

function LineRow({ line }: { line: PoVarianceLine }) {
  const color = CHANGE_COLOR[line.change];
  return (
    <div
      style={{
        fontSize: 12,
        lineHeight: '20px',
        paddingLeft: 8,
        borderLeft: `2px solid ${color}`,
        marginBottom: 2,
      }}
    >
      <Text strong style={{ color, fontSize: 12 }}>
        {CHANGE_LABEL[line.change]}
      </Text>{' '}
      <Text style={{ fontSize: 12 }}>{describeLine(line)}</Text>
      {line.change === 'modified' &&
        line.fieldChanges?.map((fc) => (
          <span key={fc.field} style={{ marginLeft: 8 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {fc.field}: {fmtValue(fc.from)} → {fmtValue(fc.to)}
            </Text>
          </span>
        ))}
    </div>
  );
}

export function VarianceDiff({ variance }: { variance: PoVariance }) {
  const changed = variance.garments.filter((g) => g.status !== 'unchanged');
  if (changed.length === 0) {
    return <Text type="secondary">No differences.</Text>;
  }

  return (
    <div>
      {changed.map((g) => (
        <div key={g.garmentId} style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 4 }}>
            <Text strong>{g.name}</Text>
            {g.status === 'removed' && (
              <Text strong style={{ color: SEMANTIC.error, marginLeft: 8, fontSize: 12 }}>
                Removed from order
              </Text>
            )}
          </div>
          {g.fieldChanges.map((fc) => (
            <FieldChangeLine key={fc.field} change={fc} />
          ))}
          {g.lines.map((line) => (
            <LineRow key={line.sizingRowId} line={line} />
          ))}
        </div>
      ))}
    </div>
  );
}
