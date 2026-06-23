'use client';

import { ConfigProvider } from 'antd';
import { lightTheme } from '@/lib/theme';

/**
 * Default app-wide antd theme (admin light). Sections that need a different look
 * — e.g. the customer-facing BeastMode pages — can nest their own ConfigProvider
 * with `darkTheme`. A light/dark toggle for admin can be layered on here later.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return <ConfigProvider theme={lightTheme}>{children}</ConfigProvider>;
}
