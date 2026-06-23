'use client';

import { useRouter } from 'next/navigation';
import { Dropdown, Avatar, Typography, Space } from 'antd';
import { UserOutlined, LogoutOutlined } from '@ant-design/icons';
import type { MenuProps } from 'antd';

interface UserMenuProps {
  name: string;
  email: string;
  role: 'sales' | 'admin';
}

export function UserMenu({ name, email, role }: UserMenuProps) {
  const router = useRouter();

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
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
                color: '#E4002B',
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
      key: 'logout',
      icon: <LogoutOutlined />,
      label: 'Sign out',
      danger: true,
      onClick: handleLogout,
    },
  ];

  return (
    <Dropdown menu={{ items }} trigger={['click']} placement="bottomRight">
      <Space style={{ cursor: 'pointer' }}>
        <Avatar icon={<UserOutlined />} size="small" style={{ backgroundColor: '#E4002B' }} />
        <span style={{ fontSize: 14 }}>{name}</span>
      </Space>
    </Dropdown>
  );
}
