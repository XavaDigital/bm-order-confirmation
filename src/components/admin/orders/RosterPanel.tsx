'use client';

import { useEffect, useState } from 'react';
import { Table, Input, Button, Space, Tag, Popconfirm, App, Typography, Spin, Alert } from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  CheckOutlined,
  CloseOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  UploadOutlined,
  MailOutlined,
} from '@ant-design/icons';
import type { ColumnType } from 'antd/es/table';
import { RosterLinkPanel } from './RosterLinkPanel';
import { RosterImportModal } from './RosterImportModal';

interface RosterMember {
  id: string;
  name: string;
  playerNumber: string | null;
  email: string | null;
  submittedAt: string | null;
}

interface RosterData {
  members: RosterMember[];
  currentAccess: { id: string; createdAt: string; revokedAt: string | null } | null;
  stats: { total: number; submitted: number };
  locked: boolean;
}

interface Props {
  orderId: string;
  customerEmail: string;
}

interface Draft {
  name: string;
  playerNumber: string;
  email: string;
}

const EMPTY_DRAFT: Draft = { name: '', playerNumber: '', email: '' };

export function RosterPanel({ orderId, customerEmail }: Props) {
  const { message } = App.useApp();
  const [data, setData] = useState<RosterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addDraft, setAddDraft] = useState<Draft>(EMPTY_DRAFT);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY_DRAFT);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [remindingId, setRemindingId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  function loadRoster() {
    setLoading(true);
    setError(null);
    return fetch(`/api/admin/orders/${orderId}/roster`)
      .then((r) => r.json())
      .then((json: RosterData) => setData(json))
      .catch(() => setError('Failed to load team roster'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadRoster();
  }, [orderId]);

  async function addMember() {
    const name = addDraft.name.trim();
    if (!name) {
      message.error('Name is required');
      return;
    }
    setAdding(true);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/roster/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          playerNumber: addDraft.playerNumber.trim() || undefined,
          email: addDraft.email.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'Failed to add member');
      setData((prev) =>
        prev && {
          ...prev,
          members: [...prev.members, json],
          stats: { ...prev.stats, total: prev.stats.total + 1 },
        },
      );
      setAddDraft(EMPTY_DRAFT);
      message.success('Team member added');
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to add member');
    } finally {
      setAdding(false);
    }
  }

  function startEdit(member: RosterMember) {
    setEditingId(member.id);
    setEditDraft({
      name: member.name,
      playerNumber: member.playerNumber ?? '',
      email: member.email ?? '',
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft(EMPTY_DRAFT);
  }

  async function saveEdit(memberId: string) {
    const name = editDraft.name.trim();
    if (!name) {
      message.error('Name is required');
      return;
    }
    setSavingId(memberId);
    try {
      const patch = {
        name,
        playerNumber: editDraft.playerNumber.trim() || null,
        email: editDraft.email.trim() || null,
      };
      const res = await fetch(`/api/admin/orders/${orderId}/roster/members/${memberId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error('Failed to save member');
      setData(
        (prev) =>
          prev && {
            ...prev,
            members: prev.members.map((m) => (m.id === memberId ? { ...m, ...patch } : m)),
          },
      );
      setEditingId(null);
      message.success('Team member updated');
    } catch {
      message.error('Failed to save member');
    } finally {
      setSavingId(null);
    }
  }

  async function removeMember(member: RosterMember) {
    setRemovingId(member.id);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/roster/members/${member.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to remove member');
      setData(
        (prev) =>
          prev && {
            ...prev,
            members: prev.members.filter((m) => m.id !== member.id),
            stats: {
              total: prev.stats.total - 1,
              submitted: prev.stats.submitted - (member.submittedAt ? 1 : 0),
            },
          },
      );
      message.success('Team member removed');
    } catch {
      message.error('Failed to remove member');
    } finally {
      setRemovingId(null);
    }
  }

  async function remindMember(member: RosterMember) {
    setRemindingId(member.id);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/roster/members/${member.id}/remind`, {
        method: 'POST',
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 503) {
        message.error('Email delivery is not configured on this server.');
        return;
      }
      if (!res.ok) throw new Error(json.error ?? 'Failed to send reminder');
      message.success(`Reminder sent to ${member.email}`);
      loadRoster(); // roster link was regenerated — refresh so the panel reflects it
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to send reminder');
    } finally {
      setRemindingId(null);
    }
  }

  if (loading) return <Spin style={{ display: 'block', marginTop: 32 }} />;
  if (error || !data) return <Alert type="error" message={error ?? 'Failed to load team roster'} />;

  const columns: ColumnType<RosterMember>[] = [
    {
      title: 'Name',
      dataIndex: 'name',
      render(_: unknown, record: RosterMember) {
        return editingId === record.id ? (
          <Input
            size="small"
            value={editDraft.name}
            onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
          />
        ) : (
          record.name
        );
      },
    },
    {
      title: '#',
      dataIndex: 'playerNumber',
      width: 70,
      render(_: unknown, record: RosterMember) {
        return editingId === record.id ? (
          <Input
            size="small"
            value={editDraft.playerNumber}
            onChange={(e) => setEditDraft((d) => ({ ...d, playerNumber: e.target.value }))}
          />
        ) : (
          (record.playerNumber ?? '—')
        );
      },
    },
    {
      title: 'Email',
      dataIndex: 'email',
      render(_: unknown, record: RosterMember) {
        return editingId === record.id ? (
          <Input
            size="small"
            value={editDraft.email}
            onChange={(e) => setEditDraft((d) => ({ ...d, email: e.target.value }))}
          />
        ) : (
          (record.email ?? '—')
        );
      },
    },
    {
      title: 'Status',
      dataIndex: 'submittedAt',
      width: 130,
      render(_: unknown, record: RosterMember) {
        return record.submittedAt ? (
          <Tag icon={<CheckCircleOutlined />} color="success">Submitted</Tag>
        ) : (
          <Tag icon={<ClockCircleOutlined />}>Pending</Tag>
        );
      },
    },
    {
      title: '',
      key: 'actions',
      width: 120,
      render(_: unknown, record: RosterMember) {
        if (editingId === record.id) {
          return (
            <Space size={4}>
              <Button
                type="text"
                size="small"
                icon={<CheckOutlined />}
                loading={savingId === record.id}
                onClick={() => saveEdit(record.id)}
              />
              <Button type="text" size="small" icon={<CloseOutlined />} onClick={cancelEdit} />
            </Space>
          );
        }
        return (
          <Space size={4}>
            {!record.submittedAt && record.email && (
              <Button
                type="text"
                size="small"
                icon={<MailOutlined />}
                title="Send a reminder email"
                loading={remindingId === record.id}
                disabled={editingId !== null}
                onClick={() => remindMember(record)}
              />
            )}
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              disabled={editingId !== null}
              onClick={() => startEdit(record)}
            />
            <Popconfirm
              title="Remove this team member?"
              description="Any sizes they submitted will also be removed."
              onConfirm={() => removeMember(record)}
              okText="Remove"
              okType="danger"
            >
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined />}
                loading={removingId === record.id}
                disabled={editingId !== null}
              />
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={24}>
      <RosterLinkPanel
        orderId={orderId}
        customerEmail={customerEmail}
        hasActiveToken={data.currentAccess !== null}
        locked={data.locked}
        stats={data.stats}
      />

      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <Typography.Text strong>Team members</Typography.Text>
          <Button size="small" icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>
            Import CSV/XLSX
          </Button>
        </div>
        <Table
          dataSource={data.members}
          columns={columns}
          rowKey="id"
          size="small"
          pagination={false}
          locale={{
            emptyText: (
              <Typography.Text type="secondary">
                No team members yet — add one below, or share the roster link so the team can add
                themselves.
              </Typography.Text>
            ),
          }}
          style={{ border: '1px solid var(--ant-color-border)', borderRadius: 4, marginBottom: 12 }}
        />
        <Space wrap>
          <Input
            size="small"
            placeholder="Name"
            style={{ width: 140 }}
            value={addDraft.name}
            onChange={(e) => setAddDraft((d) => ({ ...d, name: e.target.value }))}
            onPressEnter={addMember}
          />
          <Input
            size="small"
            placeholder="# (optional)"
            style={{ width: 90 }}
            value={addDraft.playerNumber}
            onChange={(e) => setAddDraft((d) => ({ ...d, playerNumber: e.target.value }))}
            onPressEnter={addMember}
          />
          <Input
            size="small"
            placeholder="Email (optional)"
            style={{ width: 180 }}
            value={addDraft.email}
            onChange={(e) => setAddDraft((d) => ({ ...d, email: e.target.value }))}
            onPressEnter={addMember}
          />
          <Button size="small" type="primary" icon={<PlusOutlined />} loading={adding} onClick={addMember}>
            Add member
          </Button>
        </Space>
      </div>

      <RosterImportModal
        orderId={orderId}
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={loadRoster}
      />
    </Space>
  );
}
