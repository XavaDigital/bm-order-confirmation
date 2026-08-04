'use client';

/**
 * Order notes — finalisation points ("sleeves 1cm shorter", "numbers inside
 * the hem"), David's 2026-08-04 distinction from the comments/discussion
 * thread. Short plain-text items, addable here and from the email app via the
 * capability surface; MailFlow reads the same list through the hub's brokered
 * GET, so both apps see one source of truth.
 */
import { useEffect, useState } from 'react';
import { App, Button, Input, Popconfirm, Spin, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { deleteJson, getJson, postJson } from '@/lib/api-fetch';
import { formatDateTime } from '@/lib/format';

const { Text } = Typography;

interface OrderNote {
  id: string;
  body: string;
  authorName: string | null;
  authorEmail: string | null;
  authorStaffUserId: string | null;
  createdAt: string;
  deleted: boolean;
}

interface Props {
  orderId: string;
  currentUserId: string;
  isAdmin: boolean;
}

export function OrderNotesPanel({ orderId, currentUserId, isAdmin }: Props) {
  const { message } = App.useApp();
  const [notes, setNotes] = useState<OrderNote[] | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getJson<OrderNote[]>(
      `/api/admin/orders/${orderId}/notes?kind=note&scope=all`,
      'Failed to load order notes',
    )
      .then((rows) => setNotes(rows.filter((n) => !n.deleted)))
      .catch(() => setNotes([]));
  }, [orderId]);

  async function add() {
    const body = draft.trim();
    if (!body) return;
    setSaving(true);
    try {
      const note = await postJson<OrderNote>(
        `/api/admin/orders/${orderId}/notes`,
        { body, kind: 'note' },
        'Failed to add the note',
      );
      setNotes((prev) => [...(prev ?? []), note]);
      setDraft('');
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to add the note');
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    try {
      await deleteJson(`/api/admin/orders/${orderId}/notes/${id}`, undefined, 'Failed to remove the note');
      setNotes((prev) => (prev ?? []).filter((n) => n.id !== id));
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to remove the note');
    }
  }

  if (notes === null) return <Spin size="small" />;

  return (
    <div>
      {notes.length === 0 && (
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
          Points to consider when finalising the order — e.g. “sleeves 1cm shorter”.
        </Text>
      )}
      {notes.map((n) => (
        <div
          key={n.id}
          style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 8 }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 13, display: 'block' }}>{n.body}</Text>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {n.authorName ?? n.authorEmail ?? 'Email app'} · {formatDateTime(n.createdAt)}
            </Text>
          </div>
          {(isAdmin || n.authorStaffUserId === currentUserId) && (
            <Popconfirm title="Remove this note?" okText="Remove" onConfirm={() => void remove(n.id)}>
              <Button
                size="small"
                type="text"
                icon={<DeleteOutlined />}
                aria-label="Remove note"
                style={{ flexShrink: 0 }}
              />
            </Popconfirm>
          )}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        <Input
          size="small"
          placeholder="Add an order note"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPressEnter={() => void add()}
          maxLength={2000}
        />
        <Button
          size="small"
          icon={<PlusOutlined />}
          loading={saving}
          disabled={!draft.trim()}
          onClick={() => void add()}
          aria-label="Add order note"
        />
      </div>
    </div>
  );
}
