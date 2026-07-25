'use client';

import { Input, Select, Typography } from 'antd';
import { TeamOutlined } from '@ant-design/icons';
import { buildSizeSelectOptionsWithCurrent } from '@/lib/sizes';
import type { RosterGarment, RosterMemberDto, SizeChartLink } from '@/types/customer';
import { GARMENT_BOX_STYLE } from './customerStyles';
import { SizeChartTags } from './SizeChartTags';

const { Text, Paragraph } = Typography;

/** Map of garmentId → draft size, seeded from a member's saved sizes. */
export function buildSizeDraft(
  member: Pick<RosterMemberDto, 'sizes'> | null,
  garments: RosterGarment[],
): Record<string, string> {
  const existing = new Map((member?.sizes ?? []).map((row) => [row.garmentId, row.size ?? '']));
  return Object.fromEntries(garments.map((garment) => [garment.id, existing.get(garment.id) ?? '']));
}

export interface RosterSizeEntryProps {
  garment: RosterGarment;
  /** Zero-based position — rendered as "Garment {index + 1} — {name}". */
  index: number;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  onPreviewChart: (chart: SizeChartLink) => void;
}

/**
 * Per-garment size entry block on the roster pages: garment title, notes,
 * reference size-chart chips, and the size control — a searchable dropdown of
 * chart sizes (incl. tall variants) when the garment has chart-defined sizes,
 * otherwise a free-text input.
 */
export function RosterSizeEntry({
  garment,
  index,
  value,
  onChange,
  disabled,
  onPreviewChart,
}: RosterSizeEntryProps) {
  return (
    <div style={GARMENT_BOX_STYLE}>
      <Text strong style={{ color: '#fff', display: 'block', marginBottom: 6 }}>
        Garment {index + 1} — {garment.name}
      </Text>
      {garment.notes && (
        <Paragraph style={{ color: 'rgba(255,255,255,0.55)', marginBottom: 12 }}>
          {garment.notes}
        </Paragraph>
      )}

      <SizeChartTags
        charts={garment.sizeCharts}
        onPreview={onPreviewChart}
        labelIcon={<TeamOutlined style={{ marginRight: 6 }} />}
        style={{ marginBottom: 12 }}
      />

      {garment.sizes.length > 0 ? (
        <Select
          value={value || undefined}
          onChange={(v) => onChange(v ?? '')}
          options={buildSizeSelectOptionsWithCurrent(garment.sizes, value)}
          placeholder="Select your size"
          showSearch
          allowClear
          style={{ width: '100%' }}
          disabled={disabled}
        />
      ) : (
        <Input
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Enter your size (for example: XS, S, M, L)"
          maxLength={64}
          disabled={disabled}
        />
      )}
    </div>
  );
}
