'use client';

import '@ant-design/v5-patch-for-react-19';
import { ConfigProvider, App } from 'antd';
import { lightTheme } from '@/lib/theme';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ConfigProvider theme={lightTheme}>
      <App>{children}</App>
    </ConfigProvider>
  );
}
