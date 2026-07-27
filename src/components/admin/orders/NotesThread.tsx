'use client';

/**
 * The staff conversation on an order, or on one garment of it.
 *
 * A chat rather than a log: each note shows who wrote it and when, the author
 * can edit or remove their own, and a removed note leaves a placeholder so the
 * thread keeps its shape. Reused for both scopes — pass `garmentId` for the
 * garment thread.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  App,
  Avatar,
  Button,
  Empty,
  Popconfirm,
  Skeleton,
  Space,
  Tag,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import { DeleteOutlined, EditOutlined, SendOutlined } from '@ant-design/icons';
import { deleteJson, getJson, patchJson, postJson } from '@/lib/api-fetch';
import { isNoteEmpty, sanitizeNoteHtml } from '@/lib/rich-text';
import { RichTextEditor } from '@/components/admin/RichTextEditor';

export interface OrderNote {
  id: string;
  orderId: string;
  garmentId: string | null;
  garmentName: string | null;
  bodyHtml: string | null;
  body: string;
  authorKind: 'staff' | 'email_flow' | 'system';
  authorName: string | null;
  authorEmail: string | null;
  authorLabel: string | null;
  authorStaffUserId: string | null;
  createdAt: string;
  updatedAt: string;
  edited: boolean;
  deleted: boolean;
}

interface Props {
  orderId: string;
  /** Set to scope the thread to one garment; omit for the order-wide thread. */
  garmentId?: string;
  /** The signed-in user, so their own notes get edit/delete controls. */
  currentUserId: string;
  isAdmin: boolean;
  /** Rendered above the composer when there are no notes yet. */
  emptyText?: string;
  onCountChange?: (count: number) => void;
}

const AUTHOR_KIND_TAG: Record<OrderNote['authorKind'], { label: string; color: string } | null> = {
  staff: null, // the common case needs no badge
  email_flow: { label: 'Email Flow', color: 'geekblue' },
  system: { label: 'System', color: 'default' },
};

/**
 * Render a note body. Sanitised again here, not just on write: rows can predate
 * the sanitiser or come from another writer, and this is the last point before
 * the HTML reaches the DOM.
 */
function NoteBody({ note }: { note: OrderNote }) {
  const { token } = theme.useToken();

  if (note.deleted) {
    return (
      <Typography.Text italic type="secondary" style={{ fontSize: 13 }}>
        This note was removed
      </Typography.Text>
    );
  }

  if (note.bodyHtml) {
    return (
      <div
        className="bm-note-body"
        style={{ fontSize: 13, lineHeight: 1.5, color: token.colorText }}
        dangerouslySetInnerHTML={{ __html: sanitizeNoteHtml(note.bodyHtml) }}
      />
    );
  }

  // Plain-text notes (Email Flow, system) — rendered as text, never as HTML.
  return (
    <Typography.Paragraph style={{ fontSize: 13, marginBottom: 0, whiteSpace: 'pre-wrap' }}>
      {note.body}
    </Typography.Paragraph>
  );
}

function initials(note: OrderNote): string {
  const source = note.authorName || note.authorEmail || '?';
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  return (parts[0]?.[0] ?? '?').toUpperCase() + (parts[1]?.[0]?.toUpperCase() ?? '');
}

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

export function NotesThread({
  orderId,
  garmentId,
  currentUserId,
  isAdmin,
  emptyText = 'No notes yet. Anything you add here is staff-only.',
  onCountChange,
}: Props) {
  const { message } = App.useApp();
  const [notes, setNotes] = useState<OrderNote[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const listUrl = useMemo(
    () =>
      garmentId
        ? `/api/admin/orders/${orderId}/notes?garmentId=${encodeURIComponent(garmentId)}`
        : `/api/admin/orders/${orderId}/notes`,
    [orderId, garmentId],
  );

  const load = useCallback(async () => {
    try {
      const rows = await getJson<OrderNote[]>(listUrl, 'Failed to load notes');
      setNotes(rows);
      setLoadError(null);
      onCountChange?.(rows.filter((note) => !note.deleted).length);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load notes');
      setNotes([]);
    }
  }, [listUrl, onCountChange]);

  useEffect(() => {
    void load();
  }, [load]);

  async function send() {
    const body = draft;
    // An emptied contenteditable still holds `<p><br></p>`, so String.trim()
    // would call it content. Ask the shared check instead — the same one the
    // server's contract uses, so the button and the API agree.
    if (isNoteEmpty(body)) return;

    setSending(true);
    try {
      await postJson(
        `/api/admin/orders/${orderId}/notes`,
        { body, garmentId: garmentId ?? null },
        'Failed to add the note',
      );
      setDraft('');
      await load();
      bottomRef.current?.scrollIntoView({ block: 'nearest' });
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to add the note');
    } finally {
      setSending(false);
    }
  }

  async function saveEdit(noteId: string) {
    setSavingEdit(true);
    try {
      await patchJson(
        `/api/admin/orders/${orderId}/notes/${noteId}`,
        { body: editDraft },
        'Failed to save the note',
      );
      setEditingId(null);
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to save the note');
    } finally {
      setSavingEdit(false);
    }
  }

  async function remove(noteId: string) {
    try {
      await deleteJson(
        `/api/admin/orders/${orderId}/notes/${noteId}`,
        undefined,
        'Failed to remove the note',
      );
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to remove the note');
    }
  }

  if (notes === null) return <Skeleton active paragraph={{ rows: 3 }} />;

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      {loadError ? (
        <Typography.Text type="danger">{loadError}</Typography.Text>
      ) : notes.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />
      ) : (
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
          {notes.map((note) => {
            const isAuthor = !!note.authorStaffUserId && note.authorStaffUserId === currentUserId;
            const kindTag = AUTHOR_KIND_TAG[note.authorKind];
            const isEditing = editingId === note.id;

            return (
              <div key={note.id} style={{ display: 'flex', gap: 10 }}>
                <Avatar size="small" style={{ flex: '0 0 auto' }}>
                  {initials(note)}
                </Avatar>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Space size={6} wrap style={{ marginBottom: 2 }}>
                    <Typography.Text strong style={{ fontSize: 13 }}>
                      {note.authorName || note.authorEmail || 'Unknown'}
                    </Typography.Text>
                    <Tooltip title={new Date(note.createdAt).toLocaleString()}>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {formatWhen(note.createdAt)}
                      </Typography.Text>
                    </Tooltip>
                    {note.edited && (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        (edited)
                      </Typography.Text>
                    )}
                    {kindTag && (
                      <Tag color={kindTag.color} style={{ marginInlineEnd: 0 }}>
                        {kindTag.label}
                      </Tag>
                    )}
                    {/* Only meaningful in the combined view, where a garment
                        note sits alongside order-wide ones. */}
                    {!garmentId && note.garmentName && <Tag>{note.garmentName}</Tag>}
                  </Space>

                  {isEditing ? (
                    <Space direction="vertical" size={6} style={{ width: '100%' }}>
                      <RichTextEditor
                        value={editDraft}
                        onChange={setEditDraft}
                        ariaLabel={`Edit note by ${note.authorName ?? 'you'}`}
                        minHeight={60}
                        onSubmit={() => void saveEdit(note.id)}
                      />
                      <Space size={6}>
                        <Button
                          size="small"
                          type="primary"
                          loading={savingEdit}
                          onClick={() => void saveEdit(note.id)}
                        >
                          Save
                        </Button>
                        <Button size="small" onClick={() => setEditingId(null)}>
                          Cancel
                        </Button>
                      </Space>
                    </Space>
                  ) : (
                    <>
                      <NoteBody note={note} />
                      {!note.deleted && (isAuthor || isAdmin) && (
                        <Space size={0} style={{ marginTop: 2 }}>
                          {isAuthor && (
                            <Button
                              type="text"
                              size="small"
                              icon={<EditOutlined />}
                              aria-label="Edit note"
                              onClick={() => {
                                setEditingId(note.id);
                                setEditDraft(note.bodyHtml ?? note.body);
                              }}
                            />
                          )}
                          <Popconfirm
                            title="Remove this note?"
                            description="It stays in the thread as a removed note."
                            okText="Remove"
                            okType="danger"
                            onConfirm={() => void remove(note.id)}
                          >
                            <Button
                              type="text"
                              size="small"
                              danger
                              icon={<DeleteOutlined />}
                              aria-label="Remove note"
                            />
                          </Popconfirm>
                        </Space>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </Space>
      )}

      <div>
        <RichTextEditor
          value={draft}
          onChange={setDraft}
          disabled={sending}
          placeholder={garmentId ? 'Add a note about this garment…' : 'Add a note…'}
          ariaLabel="New note"
          onSubmit={() => void send()}
        />
        <Space style={{ marginTop: 6 }}>
          <Button
            type="primary"
            size="small"
            icon={<SendOutlined />}
            loading={sending}
            disabled={isNoteEmpty(draft)}
            onClick={() => void send()}
          >
            Add note
          </Button>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Staff only — never shown to the customer.
          </Typography.Text>
        </Space>
      </div>
    </Space>
  );
}
