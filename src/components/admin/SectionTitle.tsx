'use client';

import type { ReactNode } from 'react';
import { Typography } from 'antd';

/**
 * Section heading for the admin order pages — red underline to make the
 * section boundaries scannable (David, 2026-08-04).
 */
export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <Typography.Title
      level={5}
      style={{
        marginTop: 0,
        marginBottom: 16,
        paddingBottom: 6,
        borderBottom: '2px solid #f5222d',
      }}
    >
      {children}
    </Typography.Title>
  );
}
