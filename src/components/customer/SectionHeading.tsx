'use client';

import { Typography } from 'antd';
import { BRAND } from '@/lib/theme';

const { Title } = Typography;

/** Indigo-barred section label used at the top of every customer-page card. */
export function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        borderLeft: `4px solid ${BRAND.primaryDark}`,
        paddingLeft: 12,
        marginBottom: 20,
      }}
    >
      <Title
        level={4}
        style={{
          margin: 0,
          color: '#fff',
          fontSize: 14,
          fontWeight: 600,
        }}
      >
        {children}
      </Title>
    </div>
  );
}
