'use client';

import type { CSSProperties, ReactNode } from 'react';
import { theme, Typography } from 'antd';

/**
 * Section heading for the admin pages — brand-colour underline to make the
 * section boundaries scannable (David, 2026-08-04). The colour comes from the
 * active antd theme (BRAND in src/lib/theme.ts), so restyling the brand
 * restyles every underline. `style` overrides the spacing defaults for
 * headings that sit in flex rows next to action buttons.
 */
export function SectionTitle({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  const { token } = theme.useToken();
  return (
    <Typography.Title
      level={5}
      style={{
        marginTop: 0,
        marginBottom: 16,
        paddingBottom: 6,
        borderBottom: `2px solid ${token.colorPrimary}`,
        ...style,
      }}
    >
      {children}
    </Typography.Title>
  );
}
