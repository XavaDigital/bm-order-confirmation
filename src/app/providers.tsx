'use client';

import { ConfigProvider, App } from 'antd';
import { lightTheme } from '@/lib/theme';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ConfigProvider theme={lightTheme}>
      <App>{children}</App>
    </ConfigProvider>
  );
}
