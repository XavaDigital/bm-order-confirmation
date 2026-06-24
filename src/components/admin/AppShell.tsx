'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Layout, Menu, ConfigProvider } from 'antd';
import {
  DashboardOutlined,
  FileTextOutlined,
  ProfileOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons';
import { darkTheme, lightTheme } from '@/lib/theme';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';

const { Sider, Header, Content } = Layout;

interface AppShellProps {
  user: { name: string; email: string; role: 'sales' | 'admin' };
  children: React.ReactNode;
}

const NAV_ITEMS = [
  {
    key: '/admin/dashboard',
    icon: <DashboardOutlined />,
    label: <Link href="/admin/dashboard">Dashboard</Link>,
  },
  {
    key: '/admin/orders',
    icon: <FileTextOutlined />,
    label: <Link href="/admin/orders">Orders</Link>,
  },
  {
    key: '/admin/size-charts',
    icon: <ProfileOutlined />,
    label: <Link href="/admin/size-charts">Size Charts</Link>,
  },
];

const STORAGE_KEY = 'bm-admin-theme';

export function AppShell({ user, children }: AppShellProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [isDark, setIsDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    setIsDark(stored === 'dark');
    setMounted(true);
  }, []);

  function toggleTheme() {
    const next = !isDark;
    setIsDark(next);
    localStorage.setItem(STORAGE_KEY, next ? 'dark' : 'light');
  }

  // Active sidebar key: match exact path or the closest parent segment.
  const selectedKey =
    NAV_ITEMS.find((item) => pathname === item.key || pathname.startsWith(item.key + '/'))?.key ??
    '';

  const theme = isDark ? darkTheme : lightTheme;

  // Avoid flash: render nothing until we know which theme to use.
  if (!mounted) return null;

  return (
    <ConfigProvider theme={theme}>
      <Layout style={{ minHeight: '100vh' }}>
        <Sider
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          trigger={null}
          width={220}
          style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'auto' }}
        >
          <div
            style={{
              height: 64,
              display: 'flex',
              alignItems: 'center',
              justifyContent: collapsed ? 'center' : 'flex-start',
              padding: collapsed ? 0 : '0 20px',
              borderBottom: '1px solid rgba(255,255,255,0.1)',
              overflow: 'hidden',
            }}
          >
            <span
              style={{
                color: '#BF272D',
                fontWeight: 900,
                fontSize: collapsed ? 18 : 16,
                letterSpacing: collapsed ? 0 : 2,
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
              }}
            >
              {collapsed ? 'BM' : 'BeastMode'}
            </span>
          </div>

          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[selectedKey]}
            items={NAV_ITEMS}
            style={{ borderRight: 0, marginTop: 8 }}
          />
        </Sider>

        <Layout>
          <Header
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 24px',
              position: 'sticky',
              top: 0,
              zIndex: 100,
              boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
            }}
          >
            <button
              onClick={() => setCollapsed(!collapsed)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: 18,
                color: 'inherit',
                padding: 4,
                display: 'flex',
                alignItems: 'center',
              }}
            >
              {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ThemeToggle isDark={isDark} onToggle={toggleTheme} />
              <UserMenu name={user.name} email={user.email} role={user.role} />
            </div>
          </Header>

          <Content style={{ margin: 24, minHeight: 'calc(100vh - 64px - 48px)' }}>
            {children}
          </Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  );
}
