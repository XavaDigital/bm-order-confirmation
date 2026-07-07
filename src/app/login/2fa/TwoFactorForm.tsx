'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Form, Input, Button, Typography, Alert, Divider } from 'antd';
import { SafetyCertificateOutlined } from '@ant-design/icons';
import { AuthCard } from '@/components/auth/AuthCard';
import { postJson, ApiError } from '@/lib/api-fetch';

const { Title } = Typography;

export function TwoFactorForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [useBackup, setUseBackup] = useState(false);

  async function onFinish(values: { code: string }) {
    setLoading(true);
    setError(null);

    try {
      await postJson('/api/auth/2fa/verify', { code: values.code.trim() }, 'Verification failed');

      router.push('/admin/dashboard');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <SafetyCertificateOutlined
          style={{ fontSize: 36, color: '#BF272D', marginBottom: 12 }}
        />
        <Title
          level={4}
          style={{
            color: '#fff',
            letterSpacing: 2,
            textTransform: 'uppercase',
            marginBottom: 4,
          }}
        >
          Two-Factor Auth
        </Title>
        <Typography.Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>
          {useBackup
            ? 'Enter one of your backup codes'
            : 'Enter the 6-digit code from your authenticator app'}
        </Typography.Text>
      </div>

      {error && (
        <Alert
          message={error}
          type="error"
          showIcon
          style={{ marginBottom: 24 }}
        />
      )}

      <Form layout="vertical" onFinish={onFinish} requiredMark={false} size="large">
        <Form.Item
          name="code"
          rules={[{ required: true, message: 'Enter your code' }]}
        >
          <Input
            placeholder={useBackup ? 'XXXXX-XXXXX' : '000000'}
            maxLength={useBackup ? 11 : 6}
            autoComplete="one-time-code"
            autoFocus
            style={{
              background: 'rgba(255,255,255,0.07)',
              border: '1px solid rgba(255,255,255,0.15)',
              color: '#fff',
              textAlign: 'center',
              letterSpacing: useBackup ? 2 : 8,
              fontSize: 20,
            }}
          />
        </Form.Item>

        <Form.Item style={{ marginBottom: 8, marginTop: 8 }}>
          <Button
            type="primary"
            htmlType="submit"
            loading={loading}
            block
            style={{
              height: 44,
              fontWeight: 600,
              letterSpacing: 1,
              textTransform: 'uppercase',
            }}
          >
            Verify
          </Button>
        </Form.Item>
      </Form>

      <Divider style={{ borderColor: 'rgba(255,255,255,0.1)', margin: '16px 0' }} />

      <div style={{ textAlign: 'center' }}>
        <Button
          type="link"
          size="small"
          style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12 }}
          onClick={() => {
            setUseBackup(!useBackup);
            setError(null);
          }}
        >
          {useBackup ? 'Use authenticator app instead' : "Can't access your app? Use a backup code"}
        </Button>
      </div>
    </AuthCard>
  );
}
