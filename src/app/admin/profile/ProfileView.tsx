'use client';

import { useState, useEffect } from 'react';
import {
  Card,
  Typography,
  Button,
  Alert,
  Steps,
  Input,
  Form,
  Divider,
  Tag,
  Modal,
  Space,
  message,
} from 'antd';
import {
  SafetyCertificateOutlined,
  CheckCircleOutlined,
  CopyOutlined,
  ExclamationCircleOutlined,
  LockOutlined,
} from '@ant-design/icons';
import Image from 'next/image';
import { postJson, deleteJson } from '@/lib/api-fetch';

const { Title, Text, Paragraph } = Typography;

interface TwoFAStatus {
  enabled: boolean;
  backupCodesRemaining: number;
}

interface SetupData {
  secret: string;
  qrDataUrl: string;
}

interface Props {
  user: { name: string; email: string; role: 'sales' | 'admin' };
}

export function ProfileView({ user }: Props) {
  const [status, setStatus] = useState<TwoFAStatus | null>(null);
  const [setupData, setSetupData] = useState<SetupData | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [setupStep, setSetupStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disableModalOpen, setDisableModalOpen] = useState(false);
  const [changePwLoading, setChangePwLoading] = useState(false);
  const [changePwError, setChangePwError] = useState<string | null>(null);
  const [changePwForm] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();

  useEffect(() => {
    fetchStatus();
  }, []);

  async function fetchStatus() {
    const res = await fetch('/api/admin/auth/2fa/status');
    if (res.ok) {
      setStatus(await res.json());
    }
  }

  async function startSetup(values: { password: string }) {
    setLoading(true);
    setError(null);
    try {
      const data = await postJson<SetupData>('/api/admin/auth/2fa/setup', { password: values.password }, 'Setup failed');
      setSetupData(data);
      setSetupStep(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Setup failed');
    } finally {
      setLoading(false);
    }
  }

  async function confirmSetup(values: { code: string }) {
    setLoading(true);
    setError(null);
    try {
      const data = await postJson<{ backupCodes: string[] }>('/api/admin/auth/2fa/confirm', { code: values.code.trim() }, 'Invalid code');
      setBackupCodes(data.backupCodes);
      setSetupStep(2);
      fetchStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verification failed');
    } finally {
      setLoading(false);
    }
  }

  async function disable2FA(values: { password: string }) {
    setLoading(true);
    setError(null);
    try {
      await deleteJson('/api/admin/auth/2fa/disable', { password: values.password }, 'Failed to disable');
      setDisableModalOpen(false);
      setSetupData(null);
      setBackupCodes(null);
      setSetupStep(0);
      fetchStatus();
      messageApi.success('Two-factor authentication disabled');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to disable 2FA');
    } finally {
      setLoading(false);
    }
  }

  function copyBackupCodes() {
    if (!backupCodes) return;
    navigator.clipboard.writeText(backupCodes.join('\n'));
    messageApi.success('Backup codes copied to clipboard');
  }

  async function changePassword(values: { currentPassword: string; newPassword: string }) {
    setChangePwLoading(true);
    setChangePwError(null);
    try {
      await postJson(
        '/api/admin/auth/change-password',
        { currentPassword: values.currentPassword, newPassword: values.newPassword },
        'Failed to change password',
      );
      changePwForm.resetFields();
      messageApi.success('Password changed');
    } catch (e) {
      setChangePwError(e instanceof Error ? e.message : 'Failed to change password');
    } finally {
      setChangePwLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>
      {contextHolder}
      <Title level={3} style={{ marginBottom: 8 }}>
        Profile
      </Title>
      <Text type="secondary">{user.name} &middot; {user.email}</Text>
      <Tag style={{ marginLeft: 8, textTransform: 'uppercase', fontSize: 11 }}>
        {user.role}
      </Tag>

      <Divider />

      <Card
        title={
          <Space>
            <SafetyCertificateOutlined />
            Two-Factor Authentication
            {status?.enabled && (
              <Tag color="green" icon={<CheckCircleOutlined />}>
                Enabled
              </Tag>
            )}
          </Space>
        }
        style={{ marginTop: 0 }}
      >
        {status === null ? (
          <Text type="secondary">Loading…</Text>
        ) : status.enabled && setupStep === 0 ? (
          <EnabledView
            backupCodesRemaining={status.backupCodesRemaining}
            onDisable={() => setDisableModalOpen(true)}
          />
        ) : (
          <SetupFlow
            step={setupStep}
            setupData={setupData}
            backupCodes={backupCodes}
            loading={loading}
            error={error}
            onStart={startSetup}
            onConfirm={confirmSetup}
            onCopyBackupCodes={copyBackupCodes}
          />
        )}
      </Card>

      <Divider />

      <Card
        title={
          <Space>
            <LockOutlined />
            Change Password
          </Space>
        }
      >
        {changePwError && <Alert type="error" showIcon message={changePwError} style={{ marginBottom: 16 }} />}
        <Form
          form={changePwForm}
          layout="vertical"
          onFinish={changePassword}
          requiredMark={false}
          style={{ maxWidth: 360 }}
        >
          <Form.Item
            name="currentPassword"
            label="Current password"
            rules={[{ required: true, message: 'Current password is required' }]}
          >
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Form.Item
            name="newPassword"
            label="New password"
            rules={[
              { required: true, message: 'New password is required' },
              { min: 8, message: 'Password must be at least 8 characters' },
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            name="confirmNewPassword"
            label="Confirm new password"
            dependencies={['newPassword']}
            rules={[
              { required: true, message: 'Please confirm your new password' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('newPassword') === value) return Promise.resolve();
                  return Promise.reject(new Error('Passwords do not match'));
                },
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={changePwLoading}>
            Change Password
          </Button>
        </Form>
      </Card>

      <DisableModal
        open={disableModalOpen}
        loading={loading}
        error={error}
        onClose={() => { setDisableModalOpen(false); setError(null); }}
        onDisable={disable2FA}
      />
    </div>
  );
}

// --- sub-components ----------------------------------------------------------

function EnabledView({
  backupCodesRemaining,
  onDisable,
}: {
  backupCodesRemaining: number;
  onDisable: () => void;
}) {
  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Text>
        Your account is protected with an authenticator app. You have{' '}
        <strong>{backupCodesRemaining}</strong> backup code{backupCodesRemaining !== 1 ? 's' : ''}{' '}
        remaining.
      </Text>
      {backupCodesRemaining <= 2 && (
        <Alert
          type="warning"
          showIcon
          message="Low on backup codes. Disable and re-enable 2FA to generate new ones."
        />
      )}
      <Button danger onClick={onDisable} style={{ marginTop: 8 }}>
        Disable Two-Factor Authentication
      </Button>
    </Space>
  );
}

function SetupFlow({
  step,
  setupData,
  backupCodes,
  loading,
  error,
  onStart,
  onConfirm,
  onCopyBackupCodes,
}: {
  step: number;
  setupData: SetupData | null;
  backupCodes: string[] | null;
  loading: boolean;
  error: string | null;
  onStart: (v: { password: string }) => void;
  onConfirm: (v: { code: string }) => void;
  onCopyBackupCodes: () => void;
}) {
  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Text type="secondary">
        Add an extra layer of security. You&apos;ll need an authenticator app such as{' '}
        <strong>Google Authenticator</strong>, <strong>Authy</strong>, or{' '}
        <strong>1Password</strong>.
      </Text>

      <Steps
        current={step}
        size="small"
        items={[
          { title: 'Scan QR code' },
          { title: 'Verify code' },
          { title: 'Save backup codes' },
        ]}
      />

      {error && <Alert type="error" showIcon message={error} />}

      {step === 0 && (
        <Form onFinish={onStart} requiredMark={false} layout="inline">
          <Form.Item
            name="password"
            rules={[{ required: true, message: 'Password required' }]}
          >
            <Input.Password
              placeholder="Current password"
              autoComplete="current-password"
              style={{ width: 220 }}
            />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading}>
              Set up Two-Factor Authentication
            </Button>
          </Form.Item>
        </Form>
      )}

      {step === 1 && setupData && (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Text>Scan this QR code with your authenticator app:</Text>
          <div style={{ textAlign: 'center' }}>
            <Image
              src={setupData.qrDataUrl}
              alt="2FA QR code"
              width={200}
              height={200}
              unoptimized
            />
          </div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Can&apos;t scan? Enter this secret manually:{' '}
            <Text code copyable style={{ fontSize: 12 }}>
              {setupData.secret}
            </Text>
          </Text>
          <Divider style={{ margin: '8px 0' }} />
          <Text>Then enter the 6-digit code from your app to confirm:</Text>
          <Form onFinish={onConfirm} requiredMark={false} layout="inline">
            <Form.Item
              name="code"
              rules={[
                { required: true, message: 'Enter the 6-digit code' },
                { len: 6, message: 'Code must be 6 digits' },
              ]}
            >
              <Input
                placeholder="000000"
                maxLength={6}
                autoComplete="one-time-code"
                style={{ width: 140, textAlign: 'center', letterSpacing: 6, fontSize: 18 }}
              />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" loading={loading}>
                Verify &amp; Enable
              </Button>
            </Form.Item>
          </Form>
        </Space>
      )}

      {step === 2 && backupCodes && (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Alert
            type="success"
            showIcon
            icon={<CheckCircleOutlined />}
            message="Two-factor authentication enabled!"
          />
          <Alert
            type="warning"
            showIcon
            icon={<ExclamationCircleOutlined />}
            message="Save your backup codes now — they won't be shown again."
            description="If you lose access to your authenticator app, these are the only way to sign in."
          />
          <div
            style={{
              background: 'rgba(0,0,0,0.04)',
              border: '1px solid rgba(0,0,0,0.1)',
              borderRadius: 6,
              padding: '16px 20px',
              fontFamily: 'monospace',
              lineHeight: 2,
            }}
          >
            {backupCodes.map((code) => (
              <div key={code}>{code}</div>
            ))}
          </div>
          <Button icon={<CopyOutlined />} onClick={onCopyBackupCodes}>
            Copy backup codes
          </Button>
        </Space>
      )}
    </Space>
  );
}

function DisableModal({
  open,
  loading,
  error,
  onClose,
  onDisable,
}: {
  open: boolean;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onDisable: (v: { password: string }) => void;
}) {
  return (
    <Modal
      title="Disable Two-Factor Authentication"
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
    >
      <Paragraph type="secondary">
        Enter your current password to confirm. You can re-enable 2FA at any time.
      </Paragraph>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      <Form onFinish={onDisable} requiredMark={false} layout="vertical">
        <Form.Item
          name="password"
          label="Current password"
          rules={[{ required: true, message: 'Password required' }]}
        >
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        <Space>
          <Button onClick={onClose}>Cancel</Button>
          <Button danger htmlType="submit" loading={loading}>
            Disable 2FA
          </Button>
        </Space>
      </Form>
    </Modal>
  );
}
