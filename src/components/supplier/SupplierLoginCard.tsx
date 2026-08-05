'use client';

/**
 * The supplier portal login card (David, 2026-08-05): the supplier's shared
 * portal password plus the person's own name — no accounts. The name is
 * remembered in localStorage (`bm-supplier-name`) so a returning person only
 * types the password, and it labels every comment/status change they make.
 *
 * Shared by the portal home (/supplier/[code]) and the per-PO page
 * (/supplier/po/[poNumber]) so an expired cookie shows the same gate anywhere.
 */
import { useEffect, useState } from 'react';
import { Alert, Button, Card, Input, Typography } from 'antd';
import { LoginOutlined } from '@ant-design/icons';
import { ApiError, postJson } from '@/lib/api-fetch';
import { CARD_STYLE, CARD_BODY_STYLES, FIELD_LABEL_STYLE } from '@/components/customer/customerStyles';

const { Text } = Typography;

export const SUPPLIER_NAME_STORAGE_KEY = 'bm-supplier-name';

export interface SupplierLoginCardProps {
  /** The supplier portal code from the URL. */
  code: string;
  onSuccess: (result: { name: string; supplierName: string }) => void;
}

export function SupplierLoginCard({ code, onSuccess }: SupplierLoginCardProps) {
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefill the name captured on a previous login (first-login capture).
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(SUPPLIER_NAME_STORAGE_KEY);
      if (stored) setName(stored);
    } catch {
      // Storage unavailable (private mode) — the field just starts empty.
    }
  }, []);

  async function submit() {
    const trimmedName = name.trim();
    if (!password || !trimmedName || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await postJson<{ ok: boolean; supplierName: string; name: string }>(
        `/api/supplier/${encodeURIComponent(code)}/login`,
        { password, name: trimmedName },
        'Sign in failed',
      );
      try {
        window.localStorage.setItem(SUPPLIER_NAME_STORAGE_KEY, trimmedName);
      } catch {
        // Best-effort remembering only.
      }
      onSuccess({ name: result.name, supplierName: result.supplierName });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign in failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card title="Sign in" style={{ ...CARD_STYLE, maxWidth: 420 }} styles={CARD_BODY_STYLES}>
      <Text
        style={{ color: 'rgba(255,255,255,0.65)', fontSize: 13, display: 'block', marginBottom: 16 }}
      >
        Enter your company&apos;s portal password and your name. Your name labels the updates and
        comments you make.
      </Text>

      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}

      <div style={{ marginBottom: 14 }}>
        <Text style={FIELD_LABEL_STYLE}>Portal password</Text>
        <Input.Password
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          onPressEnter={() => void submit()}
          disabled={submitting}
        />
      </div>

      <div style={{ marginBottom: 18 }}>
        <Text style={FIELD_LABEL_STYLE}>Your name</Text>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Ana"
          maxLength={80}
          onPressEnter={() => void submit()}
          disabled={submitting}
        />
      </div>

      <Button
        type="primary"
        icon={<LoginOutlined />}
        loading={submitting}
        disabled={!password || !name.trim()}
        onClick={() => void submit()}
        block
      >
        Sign in
      </Button>
    </Card>
  );
}
