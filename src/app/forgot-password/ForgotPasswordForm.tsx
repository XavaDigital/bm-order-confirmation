'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Form, Input, Button, Typography, Alert } from 'antd';
import { MailOutlined } from '@ant-design/icons';
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
        <Title
          level={3}
          style={{
            color: '#fff',
            letterSpacing: 2,
            textTransform: 'uppercase',
            marginBottom: 4,
          }}
        >
          {APP_NAME}
        </Title>
        <Typography.Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>
          Forgot your password?
        </Typography.Text>
      </div>

      {done ? (
        <>
          <Alert message={GENERIC_MESSAGE} type="success" showIcon style={{ marginBottom: 24 }} />
          <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>
            <Link href="/login" style={{ color: 'rgba(255,255,255,0.7)' }}>
              Back to sign in
            </Link>
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
              name="email"
              rules={[
                { required: true, message: 'Enter your email' },
                { type: 'email', message: 'Enter a valid email' },
              ]}
            >
              <Input
                prefix={<MailOutlined style={{ color: 'rgba(255,255,255,0.3)' }} />}
                placeholder="Email"
                autoComplete="email"
                style={{
                  background: 'rgba(255,255,255,0.07)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  color: '#fff',
                }}
              />
            </Form.Item>

            <Form.Item style={{ marginBottom: 16, marginTop: 8 }}>
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
                Send Reset Link
              </Button>
            </Form.Item>

            <div style={{ textAlign: 'center' }}>
              <Link href="/login" style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>
                Back to sign in
              </Link>
            </div>
          </Form>
        </>
      )}
    </AuthCard>
  );
}
