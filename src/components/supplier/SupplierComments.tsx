'use client';

/**
 * The supplier-facing comments card, shared by the token surface (/s/[token])
 * and the password portal's PO page. Lists the order's SHARED notes stream and
 * posts a new comment via the caller-supplied `onSend` (each surface has its
 * own API + auth).
 */
import { useState } from 'react';
import { App, Button, Card, Empty, Input, Space, Typography } from 'antd';
import { SendOutlined } from '@ant-design/icons';
import { CARD_STYLE, CARD_BODY_STYLES } from '@/components/customer/customerStyles';
import { formatCommentWhen } from './po-view-helpers';

const { Text } = Typography;

export interface SupplierComment {
  id: string;
  body: string;
  authorKind: 'staff' | 'email_flow' | 'system' | 'supplier';
  authorLabel: string | null;
  createdAt: string;
}

export interface SupplierCommentsProps {
  comments: SupplierComment[];
  /** Fallback author name for supplier comments without a label. */
  supplierName: string;
  /** Post the comment; throw to surface the error. Caller refreshes the list. */
  onSend: (body: string) => Promise<void>;
}

export function SupplierComments({ comments, supplierName, onSend }: SupplierCommentsProps) {
  const { message } = App.useApp();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await onSend(body);
      setDraft('');
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to send comment');
    } finally {
      setSending(false);
    }
  }

  return (
    <Card title="Comments" style={CARD_STYLE} styles={CARD_BODY_STYLES}>
      <Space direction="vertical" size={14} style={{ width: '100%' }}>
        {comments.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={<Text style={{ color: 'rgba(255,255,255,0.45)' }}>No comments yet</Text>}
          />
        ) : (
          comments.map((c) => (
            <div key={c.id}>
              <Space size={6} wrap style={{ marginBottom: 2 }}>
                <Text strong style={{ color: 'rgba(255,255,255,0.9)', fontSize: 13 }}>
                  {c.authorKind === 'supplier'
                    ? (c.authorLabel ?? supplierName)
                    : (c.authorLabel ?? 'BeastMode')}
                </Text>
                <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>
                  {formatCommentWhen(c.createdAt)}
                </Text>
              </Space>
              <Text
                style={{
                  color: 'rgba(255,255,255,0.8)',
                  fontSize: 13,
                  whiteSpace: 'pre-wrap',
                  display: 'block',
                }}
              >
                {c.body}
              </Text>
            </div>
          ))
        )}

        <div>
          <Input.TextArea
            rows={3}
            maxLength={2000}
            placeholder="Add a comment…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={sending}
          />
          <Button
            type="primary"
            size="small"
            icon={<SendOutlined />}
            loading={sending}
            disabled={!draft.trim()}
            onClick={() => void send()}
            style={{ marginTop: 8 }}
          >
            Send
          </Button>
        </div>
      </Space>
    </Card>
  );
}
