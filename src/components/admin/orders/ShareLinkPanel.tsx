'use client';

import { useState } from 'react';
import { Button, Space, Typography, Alert, Popconfirm, App, Divider, Tooltip } from 'antd';
import {
  LinkOutlined,
  CopyOutlined,
  ReloadOutlined,
  StopOutlined,
  MailOutlined,
} from '@ant-design/icons';

const { Text, Paragraph } = Typography;

interface Props {
  orderId: string;
  customerEmail: string;
  hasActiveToken: boolean;
  tokenCreatedAt?: string | null;
}

export function ShareLinkPanel({ orderId, customerEmail, hasActiveToken, tokenCreatedAt }: Props) {
  const { message } = App.useApp();
  const [activeUrl, setActiveUrl] = useState<string | null>(null);
  const [hasToken, setHasToken] = useState(hasActiveToken);
  const [tokenDate, setTokenDate] = useState(tokenCreatedAt ?? null);
  const [loading, setLoading] = useState<'generate' | 'revoke' | 'email' | null>(null);

  async function generate() {
    setLoading('generate');
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/token`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to generate link');
      const data: { token: string; url: string } = await res.json();
      setActiveUrl(data.url);
      setHasToken(true);
      setTokenDate(new Date().toISOString());
      message.success('Customer link generated');
    } catch {
      message.error('Failed to generate link');
    } finally {
      setLoading(null);
    }
  }

  async function revoke() {
    setLoading('revoke');
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/token`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to revoke link');
      setActiveUrl(null);
      setHasToken(false);
      setTokenDate(null);
      message.success('Link revoked — the old URL no longer works');
    } catch {
      message.error('Failed to revoke link');
    } finally {
      setLoading(null);
    }
  }

  async function emailLink() {
    setLoading('email');
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/send-link`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.status === 503) {
        message.error('Email delivery is not configured on this server.');
        return;
      }
      if (!res.ok) throw new Error(data.error ?? 'Failed to send email');
      // A new token was generated; update the displayed URL
      setActiveUrl(data.url);
      setHasToken(true);
      setTokenDate(new Date().toISOString());
      message.success(`Link emailed to ${customerEmail}`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to send email');
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

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      {!hasToken && !activeUrl && (
        <Alert
          type="info"
          showIcon
          message="No customer link generated yet"
          description="Generate a link below to share with the customer, or use 'Email to customer' to generate and send it in one step."
        />
      )}

      {hasToken && !activeUrl && (
        <Alert
          type="warning"
          showIcon
          icon={<LinkOutlined />}
          message={
            <span>
              Active link exists — URL not shown
              {tokenDate && (
                <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                  (generated {new Date(tokenDate).toLocaleString()})
                </Text>
              )}
            </span>
          }
          description="The link is only displayed once when it's generated. To copy it, use 'Email to customer' to send a fresh link directly, or 'Regenerate link' to get a new copyable URL (this invalidates the current link the customer may already have)."
        />
      )}

      {activeUrl && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Text strong>Customer link</Text>
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
            <Paragraph
              style={{ margin: 0, flex: 1, wordBreak: 'break-all', fontSize: 13 }}
              copyable={false}
            >
              {activeUrl}
            </Paragraph>
            <Button
              type="primary"
              size="small"
              icon={<CopyOutlined />}
              onClick={copyUrl}
            >
              Copy
            </Button>
          </div>
          <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
            Or use &lsquo;Email to customer&rsquo; below to send it directly without copying.
          </Text>
        </div>
      )}

      <Divider style={{ margin: '4px 0' }} />

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

        <Tooltip title={`Generates a fresh link and emails it to ${customerEmail}`}>
          <Button
            icon={<MailOutlined />}
            loading={loading === 'email'}
            disabled={loading !== null && loading !== 'email'}
            onClick={emailLink}
          >
            Email to customer
          </Button>
        </Tooltip>

        {hasToken && (
          <Popconfirm
            title="Revoke customer link?"
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
    </Space>
  );
}
