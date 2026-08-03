'use client';

/**
 * Admin controls for the short-URL roster page (David, 2026-08-03):
 * enable it per order, see/copy the typeable URL, open a preview, and manage
 * its staff-readable password (a word or digits — same readability ruling as
 * order access codes).
 */
import { useEffect, useState } from 'react';
import { App, Alert, Button, Input, Space, Switch, Tooltip, Typography } from 'antd';
import { CopyOutlined, ExportOutlined, LockOutlined, TeamOutlined } from '@ant-design/icons';
import { getJson, patchJson } from '@/lib/api-fetch';

interface Settings {
  enabled: boolean;
  password: string | null;
  url: string;
}

export function RosterPageSettings({ orderId }: { orderId: string }) {
  const { message } = App.useApp();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [passwordDraft, setPasswordDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getJson<Settings>(`/api/admin/orders/${orderId}/roster/page-settings`, 'Failed to load roster page settings')
      .then(setSettings)
      .catch(() => {});
  }, [orderId]);

  async function patch(body: { enabled?: boolean; password?: string | null }) {
    setSaving(true);
    try {
      const next = await patchJson<Settings>(
        `/api/admin/orders/${orderId}/roster/page-settings`,
        body,
        'Failed to update the roster page',
      );
      setSettings(next);
      setPasswordDraft('');
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to update the roster page');
    } finally {
      setSaving(false);
    }
  }

  if (!settings) return null;

  return (
    <Alert
      type="info"
      icon={<TeamOutlined />}
      showIcon
      message={
        <Space wrap size={12}>
          <span>Team roster page</span>
          <Switch
            checked={settings.enabled}
            loading={saving}
            checkedChildren="On"
            unCheckedChildren="Off"
            onChange={(checked) => void patch({ enabled: checked })}
            aria-label="Roster page enabled"
          />
        </Space>
      }
      description={
        settings.enabled ? (
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Space wrap size={8}>
              <Typography.Text code copyable={{ text: settings.url }}>
                {settings.url}
              </Typography.Text>
              <Button
                size="small"
                icon={<ExportOutlined />}
                href={settings.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open
              </Button>
            </Space>
            <Space wrap size={8}>
              <LockOutlined />
              {settings.password ? (
                <>
                  <Typography.Text strong copyable={{ text: settings.password, icon: <CopyOutlined /> }}>
                    {settings.password}
                  </Typography.Text>
                  <Button size="small" loading={saving} onClick={() => void patch({ password: null })}>
                    Remove password
                  </Button>
                </>
              ) : (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  No password — anyone who knows the address can open the page.
                </Typography.Text>
              )}
              <Input
                size="small"
                placeholder={settings.password ? 'Change password' : 'Set a password (4+ chars)'}
                value={passwordDraft}
                onChange={(e) => setPasswordDraft(e.target.value)}
                onPressEnter={() =>
                  passwordDraft.trim().length >= 4 && void patch({ password: passwordDraft })
                }
                style={{ width: 200 }}
                maxLength={64}
              />
              <Tooltip title={passwordDraft.trim().length < 4 ? 'At least 4 characters' : undefined}>
                <Button
                  size="small"
                  loading={saving}
                  disabled={passwordDraft.trim().length < 4}
                  onClick={() => void patch({ password: passwordDraft })}
                >
                  Save password
                </Button>
              </Tooltip>
            </Space>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Team members open the address, enter the password (if set) and their email, then add
              players and pick sizes. Each person can only edit the players they added.
            </Typography.Text>
          </Space>
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Turn on to give the team a short, typeable page for entering their own sizes.
          </Typography.Text>
        )
      }
    />
  );
}
