'use client';

import type { CSSProperties, ReactNode } from 'react';
import { Space, Tag, Typography } from 'antd';
import { FileImageOutlined, FilePdfOutlined } from '@ant-design/icons';
import type { SizeChartLink } from '@/types/customer';
import { FIELD_LABEL_STYLE } from './customerStyles';

const { Text } = Typography;

export interface SizeChartTagsProps {
  charts: SizeChartLink[];
  onPreview: (chart: SizeChartLink) => void;
  /** Icon shown before the "Reference Size Charts" label (varies per view). */
  labelIcon: ReactNode;
  /** Style for the wrapping div (e.g. bottom margin). */
  style?: CSSProperties;
}

/**
 * "Reference Size Charts" chip list. Charts with a signed URL are clickable
 * and open the preview via `onPreview`; charts without one render dimmed and
 * inert. Renders nothing when there are no charts.
 */
export function SizeChartTags({ charts, onPreview, labelIcon, style }: SizeChartTagsProps) {
  if (charts.length === 0) return null;
  return (
    <div style={style}>
      <Text style={FIELD_LABEL_STYLE}>
        {labelIcon}
        Reference Size Charts
      </Text>
      <Space wrap>
        {charts.map((chart) =>
          chart.url ? (
            <Tag
              key={chart.name}
              color="default"
              icon={
                chart.storageKey?.endsWith('.pdf') ? <FilePdfOutlined /> : <FileImageOutlined />
              }
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.2)',
                color: 'rgba(255,255,255,0.8)',
                cursor: 'pointer',
              }}
              onClick={() => onPreview(chart)}
            >
              {chart.name}
            </Tag>
          ) : (
            <Tag
              key={chart.name}
              color="default"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: 'rgba(255,255,255,0.5)',
              }}
            >
              {chart.name}
            </Tag>
          ),
        )}
      </Space>
    </div>
  );
}
