'use client';

import { useEffect, useState } from 'react';
import { Card, ConfigProvider } from 'antd';
import { BRAND, darkTheme, lightTheme } from '@/lib/theme';

interface AuthCardProps {
  children: React.ReactNode;
  maxWidth?: number;
}

// Same key AppShell uses, so the auth pages follow the staff member's theme.
const STORAGE_KEY = 'bm-admin-theme';

/**
 * Full-page centered card shell shared by the standalone auth pages — login,
 * 2FA verification, forgot/reset password, accept-invite. Mirrors the
 * SalesFlow login layout: a plain antd Card on the page-layout background.
 */
export function AuthCard({ children, maxWidth = 400 }: AuthCardProps) {
  const [isDark, setIsDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setIsDark(localStorage.getItem(STORAGE_KEY) === 'dark');
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <ConfigProvider theme={isDark ? darkTheme : lightTheme}>
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
          background: isDark ? BRAND.pageDark : '#f8fafc',
        }}
      >
        <Card style={{ width: '100%', maxWidth }} styles={{ body: { padding: '40px 32px' } }}>
          {children}
        </Card>
      </div>
    </ConfigProvider>
  );
}
