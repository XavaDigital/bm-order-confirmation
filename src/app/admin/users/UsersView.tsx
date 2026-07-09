'use client';

import { useEffect, useState } from 'react';
import {
  Table, Button, Tag, Modal, Form, Input, Select, App,
  Popconfirm, Switch, Space, Tooltip, Typography,
} from 'antd';
import {
  PlusOutlined, MailOutlined, CheckCircleOutlined,
  ClockCircleOutlined, StopOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { formatDate } from '@/lib/format';
import { getJson, postJson, patchJson, deleteJson } from '@/lib/api-fetch';

const { Title, Text } = Typography;

interface StaffUser {
  id: string;
  email: string;
  name: string;
  role: 'sales' | 'admin';
  isActive: boolean;
  isPending: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

interface UsersViewProps {
  currentUserId: string;
}

export function UsersView({ currentUserId }: UsersViewProps) {
  const { message } = App.useApp();
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [setupUrl, setSetupUrl] = useState<string | null>(null);
  const [form] = Form.useForm();

  async function fetchUsers() {
    setLoading(true);
    try {
      setUsers(await getJson<StaffUser[]>('/api/admin/users', 'Failed to load users'));
    } catch {
      message.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchUsers(); }, []);

  async function handleInvite(values: { name: string; email: string; role: 'sales' | 'admin' }) {
    setInviting(true);
    try {
      const data = await postJson<{ setupUrl?: string }>('/api/admin/users', values, 'Failed to invite user');

      form.resetFields();
      setInviteOpen(false);
      await fetchUsers();

      if (data.setupUrl) {
        // Email not configured — show the link manually.
        setSetupUrl(data.setupUrl);
      } else {
        message.success(`Invite sent to ${values.email}`);
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to invite user');
    } finally {
      setInviting(false);
    }
  }

  async function handleRoleChange(id: string, role: 'sales' | 'admin') {
    try {
      await patchJson(`/api/admin/users/${id}`, { role }, 'Failed to update role');
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, role } : u)));
      message.success('Role updated');
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to update role');
    }
  }

  async function handleToggleActive(id: string, isActive: boolean) {
    try {
      await patchJson(`/api/admin/users/${id}`, { isActive }, 'Failed to update status');
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, isActive } : u)));
      message.success(isActive ? 'User activated' : 'User deactivated');
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to update status');
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteJson(`/api/admin/users/${id}`, undefined, 'Failed to delete user');
      setUsers((prev) => prev.filter((u) => u.id !== id));
      message.success('Invite cancelled');
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to delete user');
    }
  }

  const columns: ColumnsType<StaffUser> = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record) => (
        <Space>
          <span>{name}</span>
          {record.id === currentUserId && (
            <Tag style={{ fontSize: 11 }}>You</Tag>
          )}
        </Space>
      ),
    },
    {
      title: 'Email',
      dataIndex: 'email',
      key: 'email',
    },
    {
      title: 'Role',
      key: 'role',
      render: (_, record) => {
        const isSelf = record.id === currentUserId;
        return (
          <Select
            value={record.role}
            size="small"
            disabled={isSelf}
            style={{ width: 100 }}
            onChange={(val) => handleRoleChange(record.id, val)}
            options={[
              { value: 'sales', label: 'Sales' },
              { value: 'admin', label: 'Admin' },
            ]}
          />
        );
      },
    },
    {
      title: 'Status',
      key: 'status',
      render: (_, record) => {
        if (record.isPending) {
          return (
            <Tag icon={<ClockCircleOutlined />} color="warning">
              Pending
            </Tag>
          );
        }
        if (!record.isActive) {
          return (
            <Tag icon={<StopOutlined />} color="error">
              Inactive
            </Tag>
          );
        }
        return (
          <Tag icon={<CheckCircleOutlined />} color="success">
            Active
          </Tag>
        );
      },
    },
    {
      title: 'Active',
      key: 'isActive',
      render: (_, record) => {
        const isSelf = record.id === currentUserId;
        return (
          <Tooltip title={isSelf ? 'Cannot deactivate your own account' : undefined}>
            <Switch
              checked={record.isActive}
              size="small"
              disabled={isSelf || record.isPending}
              onChange={(val) => handleToggleActive(record.id, val)}
            />
          </Tooltip>
        );
      },
    },
    {
      title: 'Last login',
      dataIndex: 'lastLoginAt',
      key: 'lastLoginAt',
      render: (val: string | null) => (val ? formatDate(val) : '—'),
    },
    {
      title: 'Joined',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (val: string) => formatDate(val),
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_, record) => {
        if (record.isPending) {
          return (
            <Popconfirm
              title="Cancel this invite?"
              description="The invite link will stop working."
              onConfirm={() => handleDelete(record.id)}
              okText="Cancel invite"
              okButtonProps={{ danger: true }}
              cancelText="Keep"
            >
              <Button size="small" danger>Cancel invite</Button>
            </Popconfirm>
          );
        }
        return null;
      },
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Title level={4} style={{ margin: 0 }}>Users</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setInviteOpen(true)}>
          Invite User
        </Button>
      </div>

      <Table
        columns={columns}
        dataSource={users}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
      />

      {/* Invite modal */}
      <Modal
        title="Invite Team Member"
        open={inviteOpen}
        onCancel={() => { setInviteOpen(false); form.resetFields(); }}
        onOk={() => form.submit()}
        okText="Send Invite"
        confirmLoading={inviting}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleInvite} style={{ marginTop: 16 }}>
          <Form.Item name="name" label="Full Name" rules={[{ required: true, message: 'Name is required' }]}>
            <Input placeholder="Jane Smith" />
          </Form.Item>
          <Form.Item
            name="email"
            label="Email"
            rules={[
              { required: true, message: 'Email is required' },
              { type: 'email', message: 'Enter a valid email' },
            ]}
          >
            <Input prefix={<MailOutlined />} placeholder="jane@example.com" />
          </Form.Item>
          <Form.Item name="role" label="Role" initialValue="sales" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'sales', label: 'Sales Staff — create & manage orders' },
                { value: 'admin', label: 'Admin — full access including user management' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* Show setup URL when email is not configured */}
      <Modal
        title="Invite Created"
        open={Boolean(setupUrl)}
        onOk={() => setSetupUrl(null)}
        onCancel={() => setSetupUrl(null)}
        cancelButtonProps={{ style: { display: 'none' } }}
        okText="Done"
      >
        <p>Email is not configured on this server. Share this setup link with the user manually — it expires in 72 hours:</p>
        <Text copyable code style={{ wordBreak: 'break-all' }}>{setupUrl}</Text>
      </Modal>
    </div>
  );
}
