'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Form, Input, Button, Typography, Alert } from 'antd';
import { APP_NAME } from '@/lib/config';
import { AuthCard } from '@/components/auth/AuthCard';
import { postJson, ApiError } from '@/lib/api-fetch';

const { Title, Text } = Typography;

interface ForgotPasswordFormValues {
  email: string;
}

const GENERIC_MESSAGE = "If an account exists for that email, we've sent a password reset link.";

export function ForgotPasswordForm() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function onFinish(values: ForgotPasswordFormValues) {
    setLoading(true);
    setError(null);

    try {
      await postJson('/api/auth/forgot-password', values, 'Request failed');
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'An unexpected error occurred. Please try again.');
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
        <Typography.Text type="secondary">Forgot your password?</Typography.Text>
      </div>

      {done ? (
        <>
          <Alert message={GENERIC_MESSAGE} type="success" showIcon style={{ marginBottom: 24 }} />
          <Text type="secondary" style={{ fontSize: 13 }}>
            <Link href="/login">Back to sign in</Link>
          </Text>
        </>
      ) : (
        <>
          {error && (
            <Alert
              message={error}
              type="error"
              showIcon
              style={{ marginBottom: 24 }}
            />
          )}

          <Form<ForgotPasswordFormValues>
            layout="vertical"
            onFinish={onFinish}
            requiredMark={false}
            size="large"
          >
            <Form.Item
              label="Email"
              name="email"
              rules={[
                { required: true, message: 'Enter your email' },
                { type: 'email', message: 'Enter a valid email' },
              ]}
            >
              <Input placeholder="you@company.com" autoComplete="email" />
            </Form.Item>

            <Form.Item style={{ marginBottom: 16, marginTop: 8 }}>
              <Button
                type="primary"
                htmlType="submit"
                loading={loading}
                block
                style={{ height: 44, fontWeight: 600 }}
              >
                Send reset link
              </Button>
            </Form.Item>

            <div style={{ textAlign: 'center' }}>
              <Link href="/login" style={{ fontSize: 13 }}>
                Back to sign in
              </Link>
            </div>
          </Form>
        </>
      )}
    </AuthCard>
  );
}
