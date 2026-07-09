'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConfigProvider, Input, Typography, Spin } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { darkTheme, BEASTMODE, headingFont } from '@/lib/theme';
import { SALES_REP_LABEL } from '@/lib/config';
import { StatusPage } from './StatusPage';

const { Title, Text, Paragraph } = Typography;

const CODE_LENGTH = 6;

/**
 * Shown instead of the order when the link has a per-order access code and
 * the visitor hasn't verified it yet. On success the server sets an HttpOnly
 * cookie and a router refresh re-renders the page with the order visible.
 */
export function AccessCodeGate({ token }: { token: string }) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function verify(value: string) {
    setVerifying(true);
    setError(null);
    try {
      const res = await fetch('/api/o/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, code: value }),
      });

      if (res.ok) {
        // Cookie is set — re-render the server page, which now shows the order.
        router.refresh();
        return;
      }

      const data = await res.json().catch(() => ({}));
      setCode('');
      setError(
        res.status === 429
          ? data.error ?? 'Too many attempts. Please try again later.'
          : 'Incorrect code. Please try again.',
      );
      setVerifying(false);
    } catch {
      setError('Something went wrong. Please try again.');
      setVerifying(false);
    }
  }

  return (
    <ConfigProvider theme={darkTheme}>
      <StatusPage icon={<LockOutlined style={{ fontSize: 64, color: BEASTMODE.accent, marginBottom: 24 }} />}>
        <Title
          style={{
            color: '#fff',
            fontSize: 42,
            fontFamily: headingFont,
            fontWeight: 400,
            letterSpacing: 5,
            textTransform: 'uppercase',
            marginBottom: 12,
          }}
        >
          Access Code Required
        </Title>
        <Text
          style={{
            color: 'rgba(255,255,255,0.6)',
            fontSize: 16,
            display: 'block',
            marginBottom: 32,
          }}
        >
          This order is protected. Enter the {CODE_LENGTH}-digit code your {SALES_REP_LABEL} gave
          you to view it.
        </Text>

        <Spin spinning={verifying}>
          <Input.OTP
            length={CODE_LENGTH}
            size="large"
            autoFocus
            value={code}
            disabled={verifying}
            onChange={(value) => {
              setCode(value);
              if (value.length === CODE_LENGTH) verify(value);
            }}
          />
        </Spin>

        {error && (
          <Paragraph style={{ color: '#ff7875', fontSize: 14, marginTop: 20 }}>{error}</Paragraph>
        )}

        <Paragraph style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13, marginTop: 32 }}>
          Don&apos;t have a code? Contact your {SALES_REP_LABEL}.
        </Paragraph>
      </StatusPage>
    </ConfigProvider>
  );
}
