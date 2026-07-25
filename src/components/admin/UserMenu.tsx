'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Dropdown, Avatar, Typography } from 'antd';
import { UserOutlined, LogoutOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { BRAND } from '@/lib/theme';
import { postJson } from '@/lib/api-fetch';

interface UserMenuProps {
  name: string;
  email: string;
  role: 'sales' | 'admin';
}

export function UserMenu({ name, email, role }: UserMenuProps) {
  const router = useRouter();

  async function handleLogout() {
    try {
      await postJson('/api/auth/logout', undefined);
    } catch {
      // Session may already be gone — navigate to the login page regardless.
    }
    router.push('/login');
    router.refresh();
  }

  const items: MenuProps['items'] = [
    {
      key: 'info',
      label: (
        <div style={{ padding: '4px 0' }}>
          <div style={{ fontWeight: 600 }}>{name}</div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {email}
          </Typography.Text>
          <div>
            <Typography.Text
              style={{
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: 1,
                color: BRAND.primaryDark,
                fontWeight: 600,
              }}
            >
              {role}
            </Typography.Text>
          </div>
        </div>
      ),
      disabled: true,
    },
    { type: 'divider' },
    {
      key: 'profile',
      icon: <SafetyCertificateOutlined />,
      label: <Link href="/admin/profile">Security (2FA)</Link>,
    },
    { type: 'divider' },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: 'Sign out',
      danger: true,
      onClick: handleLogout,
    },
  ];

  return (
    <Dropdown menu={{ items }} trigger={['click']} placement="bottomRight">
      <span
        role="button"
        aria-label="Account menu"
        style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}
      >
        <Avatar icon={<UserOutlined />} size="small" style={{ backgroundColor: BRAND.primary }} />
      </span>
    </Dropdown>
  );
}
