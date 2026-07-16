'use client';

import { useEffect, useState } from 'react';
import { Timeline, Tag, Typography, Spin, Alert } from 'antd';
import {
  BgColorsOutlined,
  LinkOutlined,
  StopOutlined,
  MailOutlined,
  EditOutlined,
  EyeOutlined,
  CheckCircleOutlined,
  MessageOutlined,
  CopyOutlined,
  CloseCircleOutlined,
  KeyOutlined,
  UserAddOutlined,
  UserDeleteOutlined,
  LockOutlined,
  UnlockOutlined,
  UploadOutlined,
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
    case 'order.color_sample_requested': return <BgColorsOutlined style={{ color: '#d46b08' }} />;
    case 'order.color_sample_resolved': return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
    case 'order.changes_requested': return <MessageOutlined style={{ color: '#faad14' }} />;
    case 'order.duplicated': return <CopyOutlined style={{ color: '#13c2c2' }} />;
    case 'order.cancelled': return <CloseCircleOutlined style={{ color: '#ff4d4f' }} />;
    case 'access_code.enabled':  return <KeyOutlined style={{ color: '#1677ff' }} />;
    case 'access_code.disabled': return <KeyOutlined style={{ color: '#ff4d4f' }} />;
    case 'roster.member_added':   return <UserAddOutlined style={{ color: '#1677ff' }} />;
    case 'roster.member_removed': return <UserDeleteOutlined style={{ color: '#ff4d4f' }} />;
    case 'roster.token_generated': return <LinkOutlined style={{ color: '#1677ff' }} />;
    case 'roster.token_revoked':   return <StopOutlined style={{ color: '#ff4d4f' }} />;
    case 'roster.locked':   return <LockOutlined style={{ color: '#faad14' }} />;
    case 'roster.unlocked': return <UnlockOutlined style={{ color: '#1677ff' }} />;
    case 'roster.import_completed': return <UploadOutlined style={{ color: '#1677ff' }} />;
    case 'roster.link_emailed':    return <MailOutlined style={{ color: '#52c41a' }} />;
    case 'roster.reminder_sent':   return <MailOutlined style={{ color: '#52c41a' }} />;
    case 'roster.member_link_generated': return <LinkOutlined style={{ color: '#1677ff' }} />;
    case 'roster.member_link_emailed':   return <MailOutlined style={{ color: '#52c41a' }} />;
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
    'order.color_sample_requested': 'Colour book / sample requested',
    'order.color_sample_resolved': 'Colour sample request resolved',
    'order.changes_requested': 'Changes requested',
    'order.duplicated': 'Duplicated from another order',
    'order.cancelled': 'Order cancelled',
    'access_code.enabled':  'Access code enabled',
    'access_code.disabled': 'Access code removed',
    'roster.member_added':   'Team member added',
    'roster.member_removed': 'Team member removed',
    'roster.token_generated': 'Roster link generated',
    'roster.token_revoked':   'Roster link revoked',
    'roster.locked':   'Roster locked',
    'roster.unlocked': 'Roster unlocked',
    'roster.import_completed': 'Roster imported from file',
    'roster.link_emailed': 'Roster link emailed',
    'roster.reminder_sent': 'Reminder sent',
    'roster.member_link_generated': 'Individual link generated',
    'roster.member_link_emailed': 'Individual link emailed',
  };
  return labels[type] ?? type;
}

function eventColor(type: string): string {
  switch (type) {
    case 'token.revoked':          return 'red';
    case 'order.confirmed':        return 'green';
    case 'order.color_sample_requested': return 'volcano';
    case 'order.color_sample_resolved': return 'green';
    case 'link.emailed':           return 'green';
    case 'order.viewed':           return 'purple';
    case 'token.generated':        return 'blue';
    case 'order.changes_requested': return 'orange';
    case 'order.duplicated':       return 'cyan';
    case 'order.cancelled':        return 'red';
    case 'access_code.enabled':    return 'blue';
    case 'access_code.disabled':   return 'red';
    case 'roster.member_added':    return 'blue';
    case 'roster.member_removed':  return 'red';
    case 'roster.token_generated': return 'blue';
    case 'roster.token_revoked':   return 'red';
    case 'roster.locked':          return 'orange';
    case 'roster.unlocked':        return 'blue';
    case 'roster.import_completed': return 'blue';
    case 'roster.link_emailed':    return 'green';
    case 'roster.reminder_sent':   return 'green';
    case 'roster.member_link_generated': return 'blue';
    case 'roster.member_link_emailed':   return 'green';
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
  if (p.sourceOrderNumber && typeof p.sourceOrderNumber === 'string') {
    parts.push(`from ${p.sourceOrderNumber}`);
  }
  if (
    (event.eventType === 'roster.member_added' ||
      event.eventType === 'roster.member_removed' ||
      event.eventType === 'roster.reminder_sent' ||
      event.eventType === 'roster.member_link_generated' ||
      event.eventType === 'roster.member_link_emailed') &&
    typeof p.name === 'string'
  ) {
    parts.push(`— ${p.name}`);
  }
  if (event.eventType === 'roster.import_completed' && typeof p.imported === 'number') {
    const skipped = (Number(p.skippedBlank) || 0) + (Number(p.skippedDuplicate) || 0);
    parts.push(`— ${p.imported} added${skipped > 0 ? `, ${skipped} skipped` : ''}`);
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
