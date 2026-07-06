'use client';

import { ConfigProvider } from 'antd';
import { BEASTMODE, darkTheme } from '@/lib/theme';

interface AuthCardProps {
  children: React.ReactNode;
  maxWidth?: number;
}

/**
 * Full-page centered dark card shell shared by the standalone auth pages —
 * login, 2FA verification, accept-invite.
 */
export function AuthCard({ children, maxWidth = 400 }: AuthCardProps) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: BEASTMODE.navy,
      }}
    >
      <ConfigProvider theme={darkTheme}>
        <div
          style={{
            width: '100%',
            maxWidth,
            padding: '48px 40px',
            background: BEASTMODE.charcoal,
            borderRadius: 8,
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          }}
        >
          {children}
        </div>
      </ConfigProvider>
    </div>
  );
}
