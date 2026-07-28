'use client';

/**
 * The notification bell and its drawer.
 *
 * Polls on an interval and on window focus rather than holding a live
 * connection. Real-time delivery (Postgres LISTEN/NOTIFY over SSE) is designed
 * but not built — see the note in CLAUDE.md; it needs a dedicated long-lived
 * pg client and an always-on instance, and the inbox is useful without it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, Drawer, Empty, List, Space, Tooltip, Typography, theme } from 'antd';
import { BellOutlined } from '@ant-design/icons';
import Link from 'next/link';
import { getJson, postJson } from '@/lib/api-fetch';

export interface InboxItem {
  id: string;
  eventKey: string;
  title: string;
  body: string | null;
  href: string | null;
  entityType: 'order' | 'purchase_order' | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
}

interface InboxResponse {
  items: InboxItem[];
  unreadCount: number;
}

/** How often to re-check while the tab is open. */
const POLL_MS = 60_000;

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function InboxBell() {
  const { token } = theme.useToken();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<InboxResponse>({ items: [], unreadCount: 0 });
  const [loading, setLoading] = useState(false);
  // A failing poll must not spam the user with toasts every minute; the bell
  // simply stops updating and the next successful poll recovers.
  const failedRef = useRef(false);

  const load = useCallback(async () => {
    try {
      setData(await getJson<InboxResponse>('/api/admin/inbox', 'Failed to load notifications'));
      failedRef.current = false;
    } catch {
      failedRef.current = true;
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  async function markAllRead() {
    setLoading(true);
    try {
      await postJson('/api/admin/inbox', {}, 'Failed to update notifications');
      await load();
    } finally {
      setLoading(false);
    }
  }

  async function openItem(item: InboxItem) {
    if (!item.readAt) {
      await postJson('/api/admin/inbox', { itemIds: [item.id] }, 'Failed to update');
      await load();
    }
    setOpen(false);
  }

  return (
    <>
      <Tooltip title="Notifications">
        <Badge count={data.unreadCount} size="small" offset={[-2, 2]}>
          <Button
            type="text"
            icon={<BellOutlined />}
            aria-label={
              data.unreadCount > 0
                ? `Notifications (${data.unreadCount} unread)`
                : 'Notifications'
            }
            onClick={() => {
              setOpen(true);
              void load();
            }}
          />
        </Badge>
      </Tooltip>

      <Drawer
        title="Notifications"
        open={open}
        onClose={() => setOpen(false)}
        width={380}
        extra={
          data.unreadCount > 0 ? (
            <Button size="small" loading={loading} onClick={() => void markAllRead()}>
              Mark all read
            </Button>
          ) : null
        }
      >
        {data.items.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nothing to catch up on" />
        ) : (
          <List
            dataSource={data.items}
            renderItem={(item) => (
              <List.Item
                style={{
                  background: item.readAt ? undefined : token.colorPrimaryBg,
                  paddingInline: 12,
                  borderRadius: 6,
                }}
              >
                <Space direction="vertical" size={2} style={{ width: '100%' }}>
                  {item.href ? (
                    <Link href={item.href} onClick={() => void openItem(item)}>
                      {item.title}
                    </Link>
                  ) : (
                    <Typography.Text strong={!item.readAt}>{item.title}</Typography.Text>
                  )}
                  {item.body && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {item.body}
                    </Typography.Text>
                  )}
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                    {formatWhen(item.createdAt)}
                  </Typography.Text>
                </Space>
              </List.Item>
            )}
          />
        )}
      </Drawer>
    </>
  );
}
