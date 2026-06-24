'use client';

import { useState } from 'react';
import { Button, Space, Typography, Alert, Popconfirm, message, Divider } from 'antd';
import {
  LinkOutlined,
  CopyOutlined,
  ReloadOutlined,
  StopOutlined,
} from '@ant-design/icons';

const { Text, Paragraph } = Typography;

interface Props {
  orderId: string;
  /** Whether an active (non-revoked) token exists in the DB */
  hasActiveToken: boolean;
  tokenCreatedAt?: string | null;
}

export function ShareLinkPanel({ orderId, hasActiveToken, tokenCreatedAt }: Props) {
  const [activeUrl, setActiveUrl] = useState<string | null>(null);
  const [hasToken, setHasToken] = useState(hasActiveToken);
  const [tokenDate, setTokenDate] = useState(tokenCreatedAt ?? null);
  const [loading, setLoading] = useState<'generate' | 'revoke' | null>(null);

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
          description="Click 'Generate link' to create a shareable URL for the customer. Generating a link will also mark this order as sent."
        />
      )}

      {hasToken && !activeUrl && (
        <Alert
          type="info"
          showIcon
          icon={<LinkOutlined />}
          message={
            <span>
              Active link exists
              {tokenDate && (
                <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                  (created {new Date(tokenDate).toLocaleString()})
                </Text>
              )}
            </span>
          }
          description="Click 'Regenerate link' to get a fresh shareable URL. This will invalidate the previous link."
        />
      )}

      {activeUrl && (
        <div>
          <Text strong>Customer link</Text>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginTop: 8,
              padding: '8px 12px',
              background: 'var(--ant-color-fill-tertiary)',
              borderRadius: 6,
              border: '1px solid var(--ant-color-border)',
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
            Send this link to the customer. It is valid until revoked.
          </Text>
        </div>
      )}

      <Divider style={{ margin: '4px 0' }} />

      <Space wrap>
        <Button
          icon={<ReloadOutlined />}
          loading={loading === 'generate'}
          disabled={loading === 'revoke'}
          onClick={generate}
        >
          {hasToken ? 'Regenerate link' : 'Generate link'}
        </Button>

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
              disabled={loading === 'generate'}
            >
              Revoke link
            </Button>
          </Popconfirm>
        )}
      </Space>
    </Space>
  );
}
