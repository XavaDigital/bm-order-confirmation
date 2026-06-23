'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Form, Input, Button, Typography, Alert } from 'antd';
import { LockOutlined, MailOutlined } from '@ant-design/icons';
import { BEASTMODE } from '@/lib/theme';

const { Title } = Typography;

interface LoginFormValues {
  email: string;
  password: string;
}

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onFinish(values: LoginFormValues) {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? 'Login failed');
        return;
      }

      const from = searchParams.get('from') ?? '/admin/dashboard';
      router.push(from);
      router.refresh();
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: BEASTMODE.navy,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 400,
          padding: '48px 40px',
          background: BEASTMODE.charcoal,
          borderRadius: 8,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}
      >
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
            BeastMode
          </Title>
          <Typography.Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>
            Order Confirmation Portal
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

        <Form<LoginFormValues>
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

          <Form.Item
            name="password"
            rules={[{ required: true, message: 'Enter your password' }]}
          >
            <Input.Password
              prefix={<LockOutlined style={{ color: 'rgba(255,255,255,0.3)' }} />}
              placeholder="Password"
              autoComplete="current-password"
              style={{
                background: 'rgba(255,255,255,0.07)',
                border: '1px solid rgba(255,255,255,0.15)',
                color: '#fff',
              }}
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0, marginTop: 8 }}>
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
              Sign In
            </Button>
          </Form.Item>
        </Form>
      </div>
    </div>
  );
}
