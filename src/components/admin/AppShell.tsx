'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Layout, Menu, ConfigProvider, App, Tooltip } from 'antd';
import {
  DashboardOutlined,
  FileTextOutlined,
  ProfileOutlined,
  TeamOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons';
import { darkTheme, lightTheme } from '@/lib/theme';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';

const { Sider, Content } = Layout;

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

  if (!mounted) return null;

  const collapseBtn = (
    <Tooltip title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} placement="right">
      <button
        onClick={() => setCollapsed(!collapsed)}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontSize: 15,
          color: 'rgba(255,255,255,0.45)',
          padding: 6,
          display: 'flex',
          alignItems: 'center',
          borderRadius: 4,
          transition: 'color 0.2s',
        }}
        onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.88)')}
        onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.45)')}
      >
        {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
      </button>
    </Tooltip>
  );

  return (
    <ConfigProvider theme={theme}>
      <App>
        <Layout style={{ minHeight: '100vh' }}>
        <Sider
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          trigger={null}
          width={220}
          style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'hidden' }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Logo + collapse */}
            <div
              style={{
                height: 64,
                display: 'flex',
                alignItems: 'center',
                justifyContent: collapsed ? 'center' : 'space-between',
                padding: collapsed ? '0 12px' : '0 12px 0 20px',
                borderBottom: '1px solid rgba(255,255,255,0.1)',
                flexShrink: 0,
              }}
            >
              {!collapsed && (
                <span
                  style={{
                    color: '#BF272D',
                    fontWeight: 900,
                    fontSize: 16,
                    letterSpacing: 2,
                    textTransform: 'uppercase',
                    whiteSpace: 'nowrap',
                  }}
                >
                  BeastMode
                </span>
              )}
              {collapseBtn}
            </div>

            {/* Nav — scrollable */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <Menu
                theme="dark"
                mode="inline"
                selectedKeys={[selectedKey]}
                items={navItems}
                style={{ borderRight: 0, marginTop: 8 }}
              />
            </div>

            {/* Bottom: theme + user */}
            <div style={{ flexShrink: 0 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  padding: collapsed ? '4px 0' : '4px 8px',
                }}
              >
                <ThemeToggle isDark={isDark} onToggle={toggleTheme} />
              </div>

              <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                <UserMenu
                  name={user.name}
                  email={user.email}
                  role={user.role}
                  collapsed={collapsed}
                />
              </div>
            </div>
          </div>
        </Sider>

        <Layout>
          <Content style={{ margin: 24, minHeight: 'calc(100vh - 48px)' }}>
            {children}
          </Content>
        </Layout>
        </Layout>
      </App>
    </ConfigProvider>
  );
}
