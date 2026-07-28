'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Layout, Menu, ConfigProvider, App, Button, Tooltip } from 'antd';
import {
  DashboardOutlined,
  FileDoneOutlined,
  ProjectOutlined,
  FileTextOutlined,
  ProfileOutlined,
  SendOutlined,
  ShopOutlined,
  SkinOutlined,
  TeamOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons';
import { darkTheme, lightTheme, BRAND } from '@/lib/theme';
import { APP_NAME } from '@/lib/config';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';
import { InboxBell } from './InboxBell';

const { Header, Sider, Content } = Layout;

const HEADER_HEIGHT = 64;
const SIDER_WIDTH = 250;

interface AppShellProps {
  user: { name: string; email: string; role: 'sales' | 'admin' };
  children: React.ReactNode;
}

function buildNavItems(role: 'sales' | 'admin') {
  const items = [
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
      key: '/admin/purchase-orders',
      icon: <FileDoneOutlined />,
      label: <Link href="/admin/purchase-orders">Purchase Orders</Link>,
    },
    {
      key: '/admin/workflow',
      icon: <ProjectOutlined />,
      label: <Link href="/admin/workflow">Workflow</Link>,
    },
    {
      key: '/admin/shipments',
      icon: <SendOutlined />,
      label: <Link href="/admin/shipments">Shipments</Link>,
    },
    {
      key: '/admin/suppliers',
      icon: <ShopOutlined />,
      label: <Link href="/admin/suppliers">Suppliers</Link>,
    },
    {
      key: '/admin/garment-types',
      icon: <SkinOutlined />,
      label: <Link href="/admin/garment-types">Garment Types</Link>,
    },
    {
      key: '/admin/size-charts',
      icon: <ProfileOutlined />,
      label: <Link href="/admin/size-charts">Size Charts</Link>,
    },
  ];

  if (role === 'admin') {
    items.push({
      key: '/admin/users',
      icon: <TeamOutlined />,
      label: <Link href="/admin/users">Users</Link>,
    });
  }

  return items;
}

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

  const navItems = buildNavItems(user.role);
  const selectedKey =
    navItems.find((item) => pathname === item.key || pathname.startsWith(item.key + '/'))?.key ??
    '';

  const theme = isDark ? darkTheme : lightTheme;
  const borderColor = isDark ? '#2a2a2a' : '#e2e8f0';

  if (!mounted) return null;

  return (
    <ConfigProvider theme={theme}>
      <App>
        <Layout style={{ minHeight: '100vh' }}>
          {/* Fixed full-width top bar (SalesFlow shell convention) */}
          <Header
            style={{
              position: 'fixed',
              top: 0,
              insetInlineStart: 0,
              width: '100%',
              zIndex: 100,
              height: HEADER_HEIGHT,
              lineHeight: `${HEADER_HEIGHT}px`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 20px',
              borderBottom: `1px solid ${borderColor}`,
            }}
          >
            <span
              style={{
                color: isDark ? '#ffffff' : '#1e293b',
                fontWeight: 700,
                fontSize: 19,
                whiteSpace: 'nowrap',
              }}
            >
              {APP_NAME}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <InboxBell />
              <ThemeToggle isDark={isDark} onToggle={toggleTheme} />
              <UserMenu name={user.name} email={user.email} role={user.role} />
            </div>
          </Header>

          <Layout style={{ paddingTop: HEADER_HEIGHT }}>
            <Sider
              collapsible
              collapsed={collapsed}
              onCollapse={setCollapsed}
              trigger={null}
              width={SIDER_WIDTH}
              theme={isDark ? 'dark' : 'light'}
              style={{
                position: 'sticky',
                top: HEADER_HEIGHT,
                height: `calc(100vh - ${HEADER_HEIGHT}px)`,
                borderRight: `1px solid ${borderColor}`,
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                <div style={{ flex: 1, overflowY: 'auto' }}>
                  <Menu
                    theme={isDark ? 'dark' : 'light'}
                    mode="inline"
                    selectedKeys={[selectedKey]}
                    items={navItems}
                    style={{ borderInlineEnd: 0, marginTop: 8 }}
                  />
                </div>
                {/* Collapse chevron pinned to the sidebar foot (SalesFlow convention) */}
                <div
                  style={{
                    flexShrink: 0,
                    padding: '8px 12px',
                    borderTop: `1px solid ${borderColor}`,
                    display: 'flex',
                    justifyContent: collapsed ? 'center' : 'flex-start',
                  }}
                >
                  <Tooltip title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} placement="right">
                    <Button
                      type="text"
                      icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                      onClick={() => setCollapsed(!collapsed)}
                    />
                  </Tooltip>
                </div>
              </div>
            </Sider>

            <Layout>
              <Content style={{ margin: 16, minHeight: `calc(100vh - ${HEADER_HEIGHT + 32}px)` }}>
                {/* Rounded content surface inset from the chrome (SalesFlow shell) */}
                <div
                  style={{
                    background: isDark ? BRAND.pageDark : '#ffffff',
                    border: `1px solid ${borderColor}`,
                    borderRadius: 12,
                    padding: 24,
                    minHeight: '100%',
                  }}
                >
                  {children}
                </div>
              </Content>
            </Layout>
          </Layout>
        </Layout>
      </App>
    </ConfigProvider>
  );
}
