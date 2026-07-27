'use client';

import type { ReactNode } from 'react';
import { Timeline, Tag, Typography, Spin, Alert } from 'antd';
import { useAdminResource } from '@/lib/use-admin-resource';
import { SEMANTIC } from '@/lib/semantic-colors';
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
  FileDoneOutlined,
  SendOutlined,
} from '@ant-design/icons';

const { Text } = Typography;

interface AuditEvent {
  id: string;
  eventType: string;
  payload: Record<string, unknown>;
  actorEmail: string | null;
  status: string;
  createdAt: string;
}

interface Props {
  orderId: string;
}

const EVENT_ICONS: Record<string, ReactNode> = {
  'token.generated': <LinkOutlined style={{ color: SEMANTIC.info }} />,
  'token.revoked':   <StopOutlined style={{ color: SEMANTIC.error }} />,
  'link.emailed':    <MailOutlined style={{ color: SEMANTIC.success }} />,
  'order.updated':   <EditOutlined style={{ color: SEMANTIC.warning }} />,
  'order.viewed':    <EyeOutlined style={{ color: SEMANTIC.viewed }} />,
  'order.confirmed': <CheckCircleOutlined style={{ color: SEMANTIC.success }} />,
  'order.color_sample_requested': <BgColorsOutlined style={{ color: SEMANTIC.hold }} />,
  'order.color_sample_resolved': <CheckCircleOutlined style={{ color: SEMANTIC.success }} />,
  'order.changes_requested': <MessageOutlined style={{ color: SEMANTIC.warning }} />,
  'order.duplicated': <CopyOutlined style={{ color: SEMANTIC.duplicate }} />,
  'order.cancelled': <CloseCircleOutlined style={{ color: SEMANTIC.error }} />,
  'access_code.enabled':  <KeyOutlined style={{ color: SEMANTIC.info }} />,
  'access_code.disabled': <KeyOutlined style={{ color: SEMANTIC.error }} />,
  'roster.member_added':   <UserAddOutlined style={{ color: SEMANTIC.info }} />,
  'roster.member_removed': <UserDeleteOutlined style={{ color: SEMANTIC.error }} />,
  'roster.token_generated': <LinkOutlined style={{ color: SEMANTIC.info }} />,
  'roster.token_revoked':   <StopOutlined style={{ color: SEMANTIC.error }} />,
  'roster.locked':   <LockOutlined style={{ color: SEMANTIC.warning }} />,
  'roster.unlocked': <UnlockOutlined style={{ color: SEMANTIC.info }} />,
  'roster.import_completed': <UploadOutlined style={{ color: SEMANTIC.info }} />,
  'roster.link_emailed':    <MailOutlined style={{ color: SEMANTIC.success }} />,
  'roster.reminder_sent':   <MailOutlined style={{ color: SEMANTIC.success }} />,
  'roster.member_link_generated': <LinkOutlined style={{ color: SEMANTIC.info }} />,
  'roster.member_link_emailed':   <MailOutlined style={{ color: SEMANTIC.success }} />,
  'po.created':        <FileDoneOutlined style={{ color: SEMANTIC.info }} />,
  'po.updated':        <EditOutlined style={{ color: SEMANTIC.warning }} />,
  'po.sent':           <MailOutlined style={{ color: SEMANTIC.success }} />,
  'po.revised':        <EditOutlined style={{ color: SEMANTIC.warning }} />,
  'po.status_changed': <FileDoneOutlined style={{ color: SEMANTIC.info }} />,
  'po.cancelled':      <CloseCircleOutlined style={{ color: SEMANTIC.error }} />,
  'shipment.created':        <SendOutlined style={{ color: SEMANTIC.info }} />,
  'shipment.updated':        <EditOutlined style={{ color: SEMANTIC.warning }} />,
  'shipment.status_changed': <SendOutlined style={{ color: SEMANTIC.info }} />,
};

function eventIcon(type: string) {
  return EVENT_ICONS[type] ?? null;
}

const EVENT_LABELS: Record<string, string> = {
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
  'order.reprint_created': 'Created as a reprint',
  'order.cancelled': 'Order cancelled',
  'order.deleted': 'Order deleted',
  'order.note_added': 'Note added',
  'note.edited':  'Note edited',
  'note.deleted': 'Note removed',
  'asset.added':   'Design / font file linked',
  'asset.updated': 'Design / font file updated',
  'asset.removed': 'Design / font file unlinked',
  'garment.added':   'Garment added',
  'garment.updated': 'Garment updated',
  'garment.removed': 'Garment removed',
  'sizing.updated':  'Sizing updated',
  'mockup.added':    'Mock-up image added',
  'mockup.removed':  'Mock-up image removed',
  'chart_links.updated': 'Size chart links updated',
  'access_code.enabled':  'Access code enabled',
  'access_code.disabled': 'Access code removed',
  'po.created':        'Purchase order raised',
  'po.updated':        'Purchase order updated',
  'po.sent':           'Purchase order sent to supplier',
  'po.revised':        'Purchase order revision issued',
  'po.status_changed': 'Purchase order status changed',
  'po.cancelled':      'Purchase order cancelled',
  'shipment.created':        'Shipment created',
  'shipment.updated':        'Shipment updated',
  'shipment.status_changed': 'Shipment status changed',
  'roster.member_added':   'Team member added',
  'roster.member_updated': 'Team member updated',
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

/** "some.future_event" → "Some future event" — readable fallback for types without a curated label. */
function prettifyEventType(type: string): string {
  const words = type.replace(/[._]/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function eventLabel(type: string): string {
  return EVENT_LABELS[type] ?? prettifyEventType(type);
}

const EVENT_COLORS: Record<string, string> = {
  'token.revoked':          'red',
  'order.confirmed':        'green',
  'order.color_sample_requested': 'volcano',
  'order.color_sample_resolved': 'green',
  'link.emailed':           'green',
  'order.viewed':           'purple',
  'token.generated':        'blue',
  'order.changes_requested': 'orange',
  'order.duplicated':       'cyan',
  'order.cancelled':        'red',
  'access_code.enabled':    'blue',
  'access_code.disabled':   'red',
  'roster.member_added':    'blue',
  'roster.member_removed':  'red',
  'roster.token_generated': 'blue',
  'roster.token_revoked':   'red',
  'roster.locked':          'orange',
  'roster.unlocked':        'blue',
  'roster.import_completed': 'blue',
  'roster.link_emailed':    'green',
  'roster.reminder_sent':   'green',
  'roster.member_link_generated': 'blue',
  'roster.member_link_emailed':   'green',
  'po.created':        'geekblue',
  'po.sent':           'green',
  'po.revised':        'orange',
  'po.cancelled':      'red',
  'shipment.created':  'blue',
};

function eventColor(type: string): string {
  return EVENT_COLORS[type] ?? 'gray';
}

function EventDetail({ event }: { event: AuditEvent }) {
  const p = event.payload;

  if (event.eventType === 'order.changes_requested' && typeof p.comment === 'string') {
    return (
      <div style={{ marginTop: 6, paddingLeft: 10, borderLeft: `2px solid ${SEMANTIC.warning}` }}>
        <Text style={{ fontSize: 12, whiteSpace: 'pre-wrap', color: 'rgba(255,255,255,0.75)' }}>
          {p.comment}
        </Text>
      </div>
    );
  }

  const parts: string[] = [];

  if (event.actorEmail) {
    parts.push(`by ${event.actorEmail}`);
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
  const { data, loading, error } = useAdminResource<{ events: AuditEvent[] }>(
    `/api/admin/orders/${orderId}/audit`,
    { errorMessage: 'Failed to load audit log', toast: false },
  );
  const events = data?.events ?? [];

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
