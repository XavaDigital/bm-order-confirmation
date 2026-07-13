'use client';

import { useState } from 'react';
import { Button, Space, Typography, Alert, Popconfirm, App, Divider, Tooltip, Switch, Progress } from 'antd';
import { LinkOutlined, CopyOutlined, ReloadOutlined, StopOutlined, LockOutlined } from '@ant-design/icons';

const { Text, Paragraph } = Typography;

interface Props {
  orderId: string;
  hasActiveToken: boolean;
  locked: boolean;
  stats: { total: number; submitted: number };
  /** Called after a lock/unlock action succeeds, so the parent tab can stay in sync. */
  onLockChange?: (locked: boolean) => void;
}

export function RosterLinkPanel({ orderId, hasActiveToken, locked, stats, onLockChange }: Props) {
  const { message } = App.useApp();
  const [activeUrl, setActiveUrl] = useState<string | null>(null);
  const [hasToken, setHasToken] = useState(hasActiveToken);
  const [isLocked, setIsLocked] = useState(locked);
  const [loading, setLoading] = useState<'generate' | 'revoke' | 'lock' | null>(null);

  const percent = stats.total > 0 ? Math.round((stats.submitted / stats.total) * 100) : 0;

  async function generate() {
    setLoading('generate');
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/roster/token`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Failed to generate roster link');
      setActiveUrl(data.url);
      setHasToken(true);
      message.success('Roster link generated');
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to generate roster link');
    } finally {
      setLoading(null);
    }
  }

  async function revoke() {
    setLoading('revoke');
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/roster/token`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to revoke roster link');
      setActiveUrl(null);
      setHasToken(false);
      message.success('Roster link revoked — the old URL no longer works');
    } catch {
      message.error('Failed to revoke roster link');
    } finally {
      setLoading(null);
    }
  }

  async function copyUrl() {
    if (!activeUrl) return;
    try {
      await navigator.clipboard.writeText(activeUrl);
      message.success('Link copied to clipboard');
    } catch {
      message.error('Copy failed — please copy manually');
    }
  }

  async function toggleLock(checked: boolean) {
    setLoading('lock');
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/roster/lock`, {
        method: checked ? 'POST' : 'DELETE',
      });
      if (!res.ok) throw new Error(checked ? 'Failed to lock roster' : 'Failed to unlock roster');
      setIsLocked(checked);
      onLockChange?.(checked);
      message.success(checked ? 'Roster locked' : 'Roster unlocked');
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to update roster lock');
    } finally {
      setLoading(null);
    }
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      {stats.total > 0 && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <Text strong>Team submissions</Text>
            <Text type="secondary">{stats.submitted} of {stats.total} submitted</Text>
          </div>
          <Progress percent={percent} status={percent === 100 ? 'success' : 'active'} />
        </div>
      )}

      {!hasToken && !activeUrl && (
        <Alert
          type="info"
          showIcon
          message="No roster link generated yet"
          description="Generate a link below and share it with the team manager — anyone with the link can add themselves and pick their size."
        />
      )}

      {hasToken && !activeUrl && (
        <Alert
          type="warning"
          showIcon
          icon={<LinkOutlined />}
          message="Active roster link exists — URL not shown"
          description="The link is only displayed once when it's generated. Use 'Regenerate link' to get a new copyable URL (this invalidates the current link the team may already have)."
        />
      )}

      {activeUrl && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Text strong>Roster link</Text>
            <Text type="warning" style={{ fontSize: 12 }}>
              — copy now, this won&apos;t be shown again after you leave this page
            </Text>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 12px',
              background: 'var(--ant-color-fill-tertiary)',
              borderRadius: 6,
              border: '1px solid var(--ant-color-warning-border, var(--ant-color-border))',
            }}
          >
            <LinkOutlined style={{ color: 'var(--ant-color-primary)', flexShrink: 0 }} />
            <Paragraph style={{ margin: 0, flex: 1, wordBreak: 'break-all', fontSize: 13 }} copyable={false}>
              {activeUrl}
            </Paragraph>
            <Button type="primary" size="small" icon={<CopyOutlined />} onClick={copyUrl}>
              Copy
            </Button>
          </div>
        </div>
      )}

      <Space wrap>
        <Tooltip title={hasToken ? 'Creates a new URL and invalidates the existing one' : undefined}>
          <Button
            icon={<ReloadOutlined />}
            loading={loading === 'generate'}
            disabled={loading !== null && loading !== 'generate'}
            onClick={generate}
          >
            {hasToken ? 'Regenerate link' : 'Generate link'}
          </Button>
        </Tooltip>

        {hasToken && (
          <Popconfirm
            title="Revoke roster link?"
            description="The current URL will stop working immediately. You can generate a new link at any time."
            onConfirm={revoke}
            okText="Revoke"
            okType="danger"
            disabled={loading !== null}
          >
            <Button
              danger
              icon={<StopOutlined />}
              loading={loading === 'revoke'}
              disabled={loading !== null && loading !== 'revoke'}
            >
              Revoke link
            </Button>
          </Popconfirm>
        )}
      </Space>

      <Divider style={{ margin: '4px 0' }} />

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <Switch
          checked={isLocked}
          loading={loading === 'lock'}
          disabled={loading !== null && loading !== 'lock'}
          onChange={toggleLock}
        />
        <div>
          <Text strong>
            <LockOutlined style={{ marginRight: 6 }} />
            Lock roster
          </Text>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 2 }}>
            Freezes the roster so team members can no longer submit or change their sizes. Staff can
            still add, edit, or remove members while locked.
          </Text>
        </div>
      </div>
    </Space>
  );
}
