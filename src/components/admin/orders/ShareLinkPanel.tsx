'use client';

import { useEffect, useState } from 'react';
import { Button, Input, Space, Typography, Alert, Popconfirm, App, Divider, Tooltip, Switch } from 'antd';
import {
  LinkOutlined,
  CopyOutlined,
  ExportOutlined,
  ReloadOutlined,
  StopOutlined,
  MailOutlined,
  KeyOutlined,
} from '@ant-design/icons';
import { formatDateTime } from '@/lib/format';
import { ApiError, deleteJson, getJson, postJson } from '@/lib/api-fetch';

const { Text, Paragraph } = Typography;

export interface GarmentCompletenessSummary {
  total: number;
  /** Names of garments with no sizing/roster rows entered. */
  missingSizing: string[];
  /** Names of garments with no mock-up images uploaded. */
  missingImages: string[];
}

interface Props {
  orderId: string;
  customerEmail: string;
  hasActiveToken: boolean;
  tokenCreatedAt?: string | null;
  hasAccessCode?: boolean;
  /** Defaults to "complete" so callers/tests that don't care about this can omit it. */
  garmentSummary?: GarmentCompletenessSummary;
}

const DEFAULT_GARMENT_SUMMARY: GarmentCompletenessSummary = {
  total: 1,
  missingSizing: [],
  missingImages: [],
};

export function ShareLinkPanel({
  orderId,
  customerEmail,
  hasActiveToken,
  tokenCreatedAt,
  hasAccessCode = false,
  garmentSummary = DEFAULT_GARMENT_SUMMARY,
}: Props) {
  const { message } = App.useApp();
  const [activeUrl, setActiveUrl] = useState<string | null>(null);
  const [hasToken, setHasToken] = useState(hasActiveToken);
  const [tokenDate, setTokenDate] = useState(tokenCreatedAt ?? null);
  const [codeEnabled, setCodeEnabled] = useState(hasAccessCode);
  const [activeCode, setActiveCode] = useState<string | null>(null);
  const [customCodeDraft, setCustomCodeDraft] = useState('');
  /** An active code from before the readable column — rotate to surface it. */
  const [legacyCode, setLegacyCode] = useState(false);
  const [loading, setLoading] = useState<'generate' | 'revoke' | 'email' | 'code' | null>(null);

  // The stored code is staff-readable on demand — load it whenever a code is
  // enabled so it displays without a regenerate dance.
  useEffect(() => {
    if (!codeEnabled || activeCode) return;
    getJson<{ code: string | null; enabled: boolean; legacy: boolean }>(
      `/api/admin/orders/${orderId}/access-code`,
      'Failed to load the access code',
    )
      .then((res) => {
        if (res.code) setActiveCode(res.code);
        setLegacyCode(res.legacy);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per enable
  }, [codeEnabled]);

  const noGarments = garmentSummary.total === 0;
  const incompleteGarments = [...new Set([...garmentSummary.missingSizing, ...garmentSummary.missingImages])];

  async function generate() {
    setLoading('generate');
    try {
      const data = await postJson<{ url: string }>(
        `/api/admin/orders/${orderId}/token`,
        undefined,
        'Failed to generate link',
      );
      setActiveUrl(data.url);
      setHasToken(true);
      setTokenDate(new Date().toISOString());
      message.success('Customer link generated');
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to generate link');
    } finally {
      setLoading(null);
    }
  }

  async function revoke() {
    setLoading('revoke');
    try {
      await deleteJson(`/api/admin/orders/${orderId}/token`, undefined, 'Failed to revoke link');
      setActiveUrl(null);
      setHasToken(false);
      setTokenDate(null);
      // The access code lives on the revoked link — a future new link starts without one.
      setCodeEnabled(false);
      setActiveCode(null);
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
      const data = await postJson<{ url: string }>(
        `/api/admin/orders/${orderId}/send-link`,
        undefined,
        'Failed to send email',
      );
      // A new token was generated; update the displayed URL
      setActiveUrl(data.url);
      setHasToken(true);
      setTokenDate(new Date().toISOString());
      message.success(`Link emailed to ${customerEmail}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        message.error('Email delivery is not configured on this server.');
        return;
      }
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

  /**
   * Enable/rotate (no argument) or set a staff-chosen code. The stored code is
   * staff-readable afterwards (David, 2026-08-03) — no relay-it-now urgency.
   */
  async function setCode(customCode?: string) {
    setLoading('code');
    try {
      const data = await postJson<{ code: string }>(
        `/api/admin/orders/${orderId}/access-code`,
        customCode ? { code: customCode } : {},
        'Failed to set access code',
      );
      setActiveCode(data.code);
      setCodeEnabled(true);
      setCustomCodeDraft('');
      setLegacyCode(false);
      message.success('Access code set');
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to set access code');
    } finally {
      setLoading(null);
    }
  }

  async function disableCode() {
    setLoading('code');
    try {
      await deleteJson(`/api/admin/orders/${orderId}/access-code`, undefined, 'Failed to remove access code');
      setActiveCode(null);
      setCodeEnabled(false);
      message.success('Access code removed — the link alone opens the order');
    } catch {
      // Match the pre-helper behavior: always the generic message.
      message.error('Failed to remove access code');
    } finally {
      setLoading(null);
    }
  }

  async function copyCode() {
    if (!activeCode) return;
    try {
      await navigator.clipboard.writeText(activeCode);
      message.success('Code copied to clipboard');
    } catch {
      message.error('Copy failed — please copy manually');
    }
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      {noGarments && (
        <Alert
          type="error"
          showIcon
          message="This order has no garments"
          description="Add at least one garment before generating or sending a customer link."
        />
      )}

      {!noGarments && incompleteGarments.length > 0 && (
        <Alert
          type="warning"
          showIcon
          message="This order looks incomplete"
          description={
            <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
              {garmentSummary.missingSizing.length > 0 && (
                <li>No sizing/roster entered: {garmentSummary.missingSizing.join(', ')}</li>
              )}
              {garmentSummary.missingImages.length > 0 && (
                <li>No mock-up image uploaded: {garmentSummary.missingImages.join(', ')}</li>
              )}
            </ul>
          }
        />
      )}

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
                  (generated {formatDateTime(tokenDate)})
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
            <Tooltip title="Opens the customer's page — note the order may show as 'viewed' once opened">
              <Button
                size="small"
                icon={<ExportOutlined />}
                href={activeUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open
              </Button>
            </Tooltip>
          </div>
          <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
            Or use &lsquo;Email to customer&rsquo; below to send it directly without copying.
          </Text>
        </div>
      )}

      <Divider style={{ margin: '4px 0' }} />

      <Space wrap>
        <Tooltip
          title={
            noGarments
              ? 'Add at least one garment first'
              : hasToken
                ? 'Creates a new URL and invalidates the existing one'
                : undefined
          }
        >
          <Button
            icon={<ReloadOutlined />}
            loading={loading === 'generate'}
            disabled={noGarments || (loading !== null && loading !== 'generate')}
            onClick={generate}
          >
            {hasToken ? 'Regenerate link' : 'Generate link'}
          </Button>
        </Tooltip>

        <Tooltip
          title={
            noGarments ? 'Add at least one garment first' : `Generates a fresh link and emails it to ${customerEmail}`
          }
        >
          <Button
            icon={<MailOutlined />}
            loading={loading === 'email'}
            disabled={noGarments || (loading !== null && loading !== 'email')}
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

      <Divider style={{ margin: '4px 0' }} />

      {/* ── Optional per-order access code ── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <Tooltip title={!hasToken ? 'Generate a customer link first' : undefined}>
            <Switch
              checked={codeEnabled}
              loading={loading === 'code'}
              disabled={!hasToken || (loading !== null && loading !== 'code')}
              onChange={(checked) => (checked ? setCode() : disableCode())}
            />
          </Tooltip>
          <div>
            <Text strong>
              <KeyOutlined style={{ marginRight: 6 }} />
              Require access code
            </Text>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 2 }}>
              The customer must also enter a code to open the order. Relay it by phone or text —
              it is never emailed with the link. The code stays the same when the link is
              regenerated, and is removed when the link is revoked.
            </Text>
          </div>
        </div>

        {activeCode && (
          <div style={{ marginTop: 12 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                background: 'var(--ant-color-fill-tertiary)',
                borderRadius: 6,
                border: '1px solid var(--ant-color-border)',
              }}
            >
              <KeyOutlined style={{ color: 'var(--ant-color-primary)', flexShrink: 0 }} />
              <Text strong style={{ flex: 1, fontSize: 18, letterSpacing: 2 }}>
                {activeCode}
              </Text>
              <Button type="primary" size="small" icon={<CopyOutlined />} onClick={copyCode}>
                Copy
              </Button>
            </div>
          </div>
        )}

        {legacyCode && !activeCode && (
          <Alert
            style={{ marginTop: 12 }}
            type="warning"
            showIcon
            icon={<KeyOutlined />}
            message="A code is active but was set before codes became viewable"
            description="Set a new one below to see it here (the old code stops working)."
          />
        )}

        {codeEnabled && (
          <Space style={{ marginTop: 12 }} wrap>
            <Input
              size="small"
              placeholder="Custom code (4+ characters)"
              value={customCodeDraft}
              onChange={(e) => setCustomCodeDraft(e.target.value)}
              onPressEnter={() => customCodeDraft.trim().length >= 4 && void setCode(customCodeDraft)}
              style={{ width: 220 }}
              maxLength={64}
            />
            <Button
              size="small"
              loading={loading === 'code'}
              disabled={customCodeDraft.trim().length < 4 || (loading !== null && loading !== 'code')}
              onClick={() => void setCode(customCodeDraft)}
            >
              Set custom code
            </Button>
            <Button
              size="small"
              loading={loading === 'code'}
              disabled={loading !== null && loading !== 'code'}
              onClick={() => void setCode()}
            >
              Generate random
            </Button>
          </Space>
        )}
      </div>
    </Space>
  );
}
