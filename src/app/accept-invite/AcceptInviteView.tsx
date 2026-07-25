'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Form, Input, Button, Typography, Alert } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { APP_NAME } from '@/lib/config';
import { AuthCard } from '@/components/auth/AuthCard';
import { postJson } from '@/lib/api-fetch';

const { Title, Text } = Typography;

export function AcceptInviteView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(values: { password: string }) {
    if (!token) {
      setError('Invalid invite link — no token found.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await postJson('/api/auth/accept-invite', { token, password: values.password }, 'Failed to set up account');
      setDone(true);
      setTimeout(() => router.push('/login?invited=1'), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <Title level={2} style={{ marginBottom: 4 }}>
          {APP_NAME}
        </Title>
        <Title level={5} style={{ margin: 0 }}>
          Set up your account
        </Title>
        <Text type="secondary" style={{ fontSize: 13 }}>
          Choose a password to activate your account.
        </Text>
      </div>

      {!token && (
        <Alert
          type="error"
          message="Invalid invite link"
          description="This link is missing the required token. Please request a new invite."
          showIcon
        />
      )}

      {done && (
        <Alert
          type="success"
          message="Account activated!"
          description="Redirecting you to login…"
          showIcon
        />
      )}

      {!done && token && (
        <Form layout="vertical" onFinish={handleSubmit}>
          {error && (
            <Alert
              type="error"
              message={error}
              showIcon
              style={{ marginBottom: 16 }}
              closable
              onClose={() => setError(null)}
            />
          )}

          <Form.Item
            name="password"
            label="Password"
            rules={[
              { required: true, message: 'Password is required' },
              { min: 8, message: 'Password must be at least 8 characters' },
            ]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="Min 8 characters" size="large" />
          </Form.Item>

          <Form.Item
            name="confirm"
            label="Confirm Password"
            dependencies={['password']}
            rules={[
              { required: true, message: 'Please confirm your password' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('password') === value) return Promise.resolve();
                  return Promise.reject(new Error('Passwords do not match'));
                },
              }),
            ]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="Repeat password" size="large" />
          </Form.Item>

          <Button type="primary" htmlType="submit" loading={loading} block size="large">
            Activate Account
          </Button>
        </Form>
      )}
    </AuthCard>
  );
}
