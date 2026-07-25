'use client';

import type { ReactNode } from 'react';
import { Typography } from 'antd';

interface Props {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Right-aligned actions (buttons, links). */
  extra?: ReactNode;
}

/**
 * Shared admin page title row: Typography.Title + optional secondary subtitle
 * on the left, action buttons on the right. Extracted verbatim from the
 * hand-rolled headers on the Orders / Size Charts / Dashboard pages.
 */
export function AdminPageHeader({ title, subtitle, extra }: Props) {
  return (
    <div
      style={{
        marginBottom: 24,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
      }}
    >
      <div>
        <Typography.Title level={3} style={{ marginBottom: 4 }}>
          {title}
        </Typography.Title>
        {subtitle != null && (
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            {subtitle}
          </Typography.Paragraph>
        )}
      </div>
      {extra}
    </div>
  );
}
