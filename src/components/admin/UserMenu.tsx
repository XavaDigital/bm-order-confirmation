'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Dropdown, Avatar, Tooltip, Typography } from 'antd';
import { UserOutlined, LogoutOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import type { MenuProps } from 'antd';

interface UserMenuProps {
  name: string;
  email: string;
  role: 'sales' | 'admin';
  collapsed?: boolean;
}

export function UserMenu({ name, email, role, collapsed }: UserMenuProps) {
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
                color: '#BF272D',
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

  const trigger = collapsed ? (
    <Tooltip title={name} placement="right">
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          padding: '10px 0',
          cursor: 'pointer',
        }}
      >
        <Avatar icon={<UserOutlined />} size="small" style={{ backgroundColor: '#BF272D' }} />
      </div>
    </Tooltip>
  ) : (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 16px',
        cursor: 'pointer',
        borderRadius: 6,
        transition: 'background 0.2s',
      }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.06)')}
      onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.background = 'transparent')}
    >
      <Avatar icon={<UserOutlined />} size="small" style={{ backgroundColor: '#BF272D', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontWeight: 600,
            fontSize: 13,
            color: 'rgba(255,255,255,0.88)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {name}
        </div>
        <div
          style={{
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: 1,
            color: '#BF272D',
            fontWeight: 600,
          }}
        >
          {role}
        </div>
      </div>
    </div>
  );

  return (
    <Dropdown menu={{ items }} trigger={['click']} placement="topRight">
      {trigger}
    </Dropdown>
  );
}
