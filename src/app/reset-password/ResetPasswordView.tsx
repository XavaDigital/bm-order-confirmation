'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Form, Input, Button, Typography, Alert } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { APP_NAME } from '@/lib/config';
import { AuthCard } from '@/components/auth/AuthCard';
import { postJson, ApiError } from '@/lib/api-fetch';

const { Title, Text } = Typography;

export function ResetPasswordView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(values: { password: string }) {
    if (!token) {
      setError('Invalid reset link — no token found.');
      return;
    }
    setLoading(true);
    setError(null);
    setExpired(false);
    try {
      await postJson('/api/auth/reset-password', { token, password: values.password }, 'Failed to reset password');
      setDone(true);
      setTimeout(() => router.push('/login?reset=1'), 2000);
    } catch (err) {
      if (err instanceof ApiError && err.status === 410) {
        setExpired(true);
      } else {
        setError(err instanceof Error ? err.message : 'Something went wrong');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div
          style={{
            fontSize: 22,
            fontWeight: 900,
            color: '#BF272D',
            letterSpacing: 2,
            textTransform: 'uppercase',
            marginBottom: 8,
          }}
        >
          {APP_NAME.toUpperCase()}
        </div>
        <Title level={4} style={{ margin: 0, color: '#fff' }}>
          Reset Your Password
        </Title>
        <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>
          Choose a new password for your account.
        </Text>
      </div>

      {!token && (
        <Alert
          type="error"
          message="Invalid reset link"
          description="This link is missing the required token. Please request a new one."
          showIcon
        />
      )}

      {expired && (
        <Alert
          type="error"
          showIcon
          message="This link has expired"
          description={
            <span>
              Password reset links expire after 1 hour. Please{' '}
              <Link href="/forgot-password" style={{ color: 'inherit', textDecoration: 'underline' }}>
                request a new one
              </Link>
              .
            </span>
          }
        />
      )}

      {done && (
        <Alert
          type="success"
          message="Password updated!"
          description="Redirecting you to login…"
          showIcon
        />
      )}

      {!done && !expired && token && (
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
            label={<span style={{ color: 'rgba(255,255,255,0.8)' }}>New Password</span>}
            rules={[
              { required: true, message: 'Password is required' },
              { min: 8, message: 'Password must be at least 8 characters' },
            ]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="Min 8 characters" size="large" autoComplete="new-password" />
          </Form.Item>

          <Form.Item
            name="confirm"
            label={<span style={{ color: 'rgba(255,255,255,0.8)' }}>Confirm New Password</span>}
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
            <Input.Password prefix={<LockOutlined />} placeholder="Repeat password" size="large" autoComplete="new-password" />
          </Form.Item>

          <Button type="primary" htmlType="submit" loading={loading} block size="large">
            Reset Password
          </Button>
        </Form>
      )}
    </AuthCard>
  );
}
