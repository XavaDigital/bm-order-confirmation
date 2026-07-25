'use client';

import type { ReactNode } from 'react';
import Image from 'next/image';
import { ConfigProvider, Typography } from 'antd';
import { APP_NAME } from '@/lib/config';
import { BRAND, darkTheme } from '@/lib/theme';

const { Title, Text } = Typography;

export interface CustomerPageShellProps {
  /** Small uppercase kicker next to the logo, e.g. "Order Confirmation". */
  label: string;
  /** Large page heading (order number, club name, member name…). */
  title: ReactNode;
  /** Optional line under the heading. Omit to render nothing. */
  subtitle?: ReactNode;
  /** Subtitle text color — the order view uses a slightly dimmer tone. */
  subtitleColor?: string;
  children: ReactNode;
}

/**
 * Shared scaffold for the customer surface (`/o/**`): dark page background,
 * branded hero header (logo, kicker, title, subtitle), and the centered
 * 860px content column — all wrapped in the dark antd theme. Modals may be
 * rendered inside `children`; antd portals them to the body.
 */
export function CustomerPageShell({
  label,
  title,
  subtitle,
  subtitleColor = 'rgba(255,255,255,0.6)',
  children,
}: CustomerPageShellProps) {
  return (
    <ConfigProvider theme={darkTheme}>
      <div style={{ minHeight: '100vh', background: BRAND.pageDark }}>
        <header
          style={{
            background: BRAND.chromeDark,
            borderBottom: `3px solid ${BRAND.primaryDark}`,
            padding: '24px',
          }}
        >
          <div style={{ maxWidth: 860, margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
              {/* Actual logo from beastmode.co.nz — SVG paths render correctly without page fonts */}
              <Image
                src="/logo.svg"
                alt={APP_NAME}
                width={141}
                height={44}
                priority
                style={{ display: 'block' }}
              />
              <div
                style={{
                  width: 1,
                  height: 24,
                  background: 'rgba(255,255,255,0.2)',
                  flexShrink: 0,
                }}
              />
              <div
                style={{
                  fontSize: 11,
                  color: 'rgba(255,255,255,0.5)',
                  letterSpacing: 3,
                  textTransform: 'uppercase',
                  fontWeight: 600,
                }}
              >
                {label}
              </div>
            </div>
            <Title level={2} style={{ color: '#fff', margin: 0, fontWeight: 900, letterSpacing: 1 }}>
              {title}
            </Title>
            {subtitle != null && (
              <Text
                style={{ color: subtitleColor, fontSize: 15, marginTop: 4, display: 'block' }}
              >
                {subtitle}
              </Text>
            )}
          </div>
        </header>

        <main style={{ maxWidth: 860, margin: '0 auto', padding: '32px 24px 80px' }}>
          {children}
        </main>
      </div>
    </ConfigProvider>
  );
}
