'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Form, Input, Button, Alert } from 'antd';
import { postJson, ApiError } from '@/lib/api-fetch';
import { goAfterAuth } from '@/lib/post-auth-redirect';

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
      const data = await postJson<{ requiresMfa?: boolean }>('/api/auth/login', values, 'Login failed');

      if (data.requiresMfa) {
        router.push('/login/2fa');
        return;
      }

      // `from` comes straight off the query string, so it is validated inside
      // goAfterAuth rather than trusted.
      goAfterAuth(searchParams.get('from'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  /**
   * The card shell and the heading belong to the PAGE, not to this form: once
   * identity is configured the password form is hidden, and when it owned the
   * card it took the styling and the branding down with it.
   */
  return (
    <>
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
          label="Email"
          name="email"
          rules={[
            { required: true, message: 'Enter your email' },
            { type: 'email', message: 'Enter a valid email' },
          ]}
        >
          <Input placeholder="you@company.com" autoComplete="email" />
        </Form.Item>

        <Form.Item
          label="Password"
          name="password"
          rules={[{ required: true, message: 'Enter your password' }]}
        >
          <Input.Password placeholder="Password" autoComplete="current-password" />
        </Form.Item>

        <div style={{ textAlign: 'right', marginBottom: 8, marginTop: -8 }}>
          <Link href="/forgot-password" style={{ fontSize: 13 }}>
            Forgot password?
          </Link>
        </div>

        <Form.Item style={{ marginBottom: 0, marginTop: 8 }}>
          <Button type="primary" htmlType="submit" loading={loading} block style={{ height: 44, fontWeight: 600 }}>
            Sign in
          </Button>
        </Form.Item>
      </Form>
    </>
  );
}
