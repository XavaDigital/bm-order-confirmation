'use client';

import { useEffect, useState } from 'react';
import { Timeline, Tag, Typography, Spin, Alert } from 'antd';
import {
  LinkOutlined,
  StopOutlined,
  MailOutlined,
  EditOutlined,
  EyeOutlined,
  CheckCircleOutlined,
  MessageOutlined,
} from '@ant-design/icons';

const { Text } = Typography;

interface AuditEvent {
  id: string;
  eventType: string;
  payload: Record<string, unknown>;
  status: string;
  createdAt: string;
}

interface Props {
  orderId: string;
}

function eventIcon(type: string) {
  switch (type) {
    case 'token.generated': return <LinkOutlined style={{ color: '#1677ff' }} />;
    case 'token.revoked':   return <StopOutlined style={{ color: '#ff4d4f' }} />;
    case 'link.emailed':    return <MailOutlined style={{ color: '#52c41a' }} />;
    case 'order.updated':   return <EditOutlined style={{ color: '#faad14' }} />;
    case 'order.viewed':    return <EyeOutlined style={{ color: '#722ed1' }} />;
    case 'order.confirmed': return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
    case 'order.changes_requested': return <MessageOutlined style={{ color: '#faad14' }} />;
    default: return null;
  }
}

function eventLabel(type: string): string {
  const labels: Record<string, string> = {
    'token.generated': 'Link generated',
    'token.revoked':   'Link revoked',
    'link.emailed':    'Link emailed to customer',
    'order.updated':   'Order details updated',
    'order.viewed':    'Customer viewed order',
    'order.confirmed': 'Customer confirmed order',
    'order.changes_requested': 'Changes requested',
  };
  return labels[type] ?? type;
}

function eventColor(type: string): string {
  switch (type) {
    case 'token.revoked':          return 'red';
    case 'order.confirmed':        return 'green';
    case 'link.emailed':           return 'green';
    case 'order.viewed':           return 'purple';
    case 'token.generated':        return 'blue';
    case 'order.changes_requested': return 'orange';
    default:                       return 'gray';
  }
}

function EventDetail({ event }: { event: AuditEvent }) {
  const p = event.payload;

  if (event.eventType === 'order.changes_requested' && typeof p.comment === 'string') {
    return (
      <div style={{ marginTop: 6, paddingLeft: 10, borderLeft: '2px solid #faad14' }}>
        <Text style={{ fontSize: 12, whiteSpace: 'pre-wrap', color: 'rgba(255,255,255,0.75)' }}>
          {p.comment}
        </Text>
      </div>
    );
  }

  const parts: string[] = [];

  if (p.actorEmail && typeof p.actorEmail === 'string') {
    parts.push(`by ${p.actorEmail}`);
  }
  if (p.to && typeof p.to === 'string') {
    parts.push(`→ ${p.to}`);
  }
  if (p.orderStatus === 'changes_requested') {
    parts.push('(re-sent after changes request)');
  }
  if (Array.isArray(p.fields) && p.fields.length > 0) {
    parts.push(`(${(p.fields as string[]).join(', ')})`);
  }

  return parts.length > 0 ? (
    <Text type="secondary" style={{ fontSize: 12 }}>
      {parts.join(' ')}
    </Text>
  ) : null;
}

export function AuditLogTab({ orderId }: Props) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/admin/orders/${orderId}/audit`)
      .then((r) => r.json())
      .then((data: { events: AuditEvent[] }) => setEvents(data.events ?? []))
      .catch(() => setError('Failed to load audit log'))
      .finally(() => setLoading(false));
  }, [orderId]);

  if (loading) return <Spin style={{ display: 'block', marginTop: 32 }} />;
  if (error) return <Alert type="error" message={error} />;
  if (events.length === 0) {
    return (
      <Text type="secondary" style={{ display: 'block', marginTop: 16 }}>
        No activity recorded yet.
      </Text>
    );
  }

  const items = events.map((ev) => ({
    key: ev.id,
    dot: eventIcon(ev.eventType),
    color: eventColor(ev.eventType),
    children: (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Tag color={eventColor(ev.eventType)} style={{ margin: 0 }}>
            {eventLabel(ev.eventType)}
          </Tag>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {new Date(ev.createdAt).toLocaleString('en-NZ', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </Text>
        </div>
        <div style={{ marginTop: 4 }}>
          <EventDetail event={ev} />
        </div>
      </div>
    ),
  }));

  return <Timeline style={{ marginTop: 16 }} items={items} />;
}
