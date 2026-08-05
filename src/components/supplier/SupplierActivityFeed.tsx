'use client';

/**
 * The supplier-side activity feed (David, 2026-08-06): ONE chronological
 * stream of comments, production-file uploads and status changes on a PO —
 * "a nice chronological reference". Image uploads render as inline thumbnails
 * so a test print can be commented on right where it appears; every file entry
 * keeps its own comment composer, and the general comment box sits at the
 * bottom like a chat.
 *
 * Shared by the password portal's PO page (comments + files + statuses) and
 * the legacy /s/[token] link (comments + statuses only — that surface has no
 * files API, so the `files` prop is simply omitted). Merging/ordering lives in
 * the pure `buildActivityFeed` helper.
 */
import { useState } from 'react';
import { App, Button, Card, Empty, Input, Space, Tag, Typography } from 'antd';
import { DownloadOutlined, PaperClipOutlined, SendOutlined } from '@ant-design/icons';
import { poStatusMeta } from '@/lib/status';
import { CARD_STYLE, CARD_BODY_STYLES } from '@/components/customer/customerStyles';
import {
  buildActivityFeed,
  formatCommentWhen,
  isImageFileName,
  type SupplierComment,
  type SupplierStatusChange,
} from './po-view-helpers';
import type { PoFileItem } from './SupplierPoFiles';

const { Text } = Typography;

export interface SupplierActivityFeedProps {
  comments: SupplierComment[];
  statusHistory: SupplierStatusChange[];
  /** Production files with their comment threads. Omit on surfaces without a files API. */
  files?: PoFileItem[] | null;
  /** Fallback author name for supplier comments without a label. */
  supplierName: string;
  /** Post a general comment; throw to surface the error. Caller refreshes. */
  onSendComment: (body: string) => Promise<void>;
  /** Post a comment on one file; omit to hide the per-file composers. */
  onSendFileComment?: (fileId: string, body: string) => Promise<void>;
}

function commentAuthor(
  comment: { authorKind: string; authorLabel: string | null; authorName?: string | null },
  supplierName: string,
): string {
  if (comment.authorKind === 'supplier') return comment.authorLabel ?? supplierName;
  return comment.authorName ?? comment.authorLabel ?? 'BeastMode';
}

function CommentBlock({
  comment,
  supplierName,
}: {
  comment: { authorKind: string; authorLabel: string | null; authorName?: string | null; body: string; createdAt: string };
  supplierName: string;
}) {
  return (
    <div>
      <Space size={6} wrap style={{ marginBottom: 2 }}>
        <Text strong style={{ color: 'rgba(255,255,255,0.9)', fontSize: 13 }}>
          {commentAuthor(comment, supplierName)}
        </Text>
        <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>
          {formatCommentWhen(comment.createdAt)}
        </Text>
      </Space>
      <Text
        style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13, whiteSpace: 'pre-wrap', display: 'block' }}
      >
        {comment.body}
      </Text>
    </div>
  );
}

/** "Status: Design prep → Test print — Ana (Dynasty), 6 Aug, 14:32" */
function StatusLine({ change }: { change: SupplierStatusChange }) {
  const arrow = change.from ? `${poStatusMeta(change.from).label} → ` : '';
  return (
    <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, display: 'block' }}>
      Status: {arrow}
      {poStatusMeta(change.to).label}
      {change.by ? ` — ${change.by}` : ''}, {formatCommentWhen(change.at)}
    </Text>
  );
}

export function SupplierActivityFeed({
  comments,
  statusHistory,
  files,
  supplierName,
  onSendComment,
  onSendFileComment,
}: SupplierActivityFeedProps) {
  const { message } = App.useApp();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [fileDrafts, setFileDrafts] = useState<Record<string, string>>({});
  const [sendingFor, setSendingFor] = useState<string | null>(null);

  const feed = buildActivityFeed({ comments, files, statusChanges: statusHistory });

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await onSendComment(body);
      setDraft('');
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to send comment');
    } finally {
      setSending(false);
    }
  }

  async function sendFileComment(fileId: string) {
    if (!onSendFileComment) return;
    const body = (fileDrafts[fileId] ?? '').trim();
    if (!body || sendingFor) return;
    setSendingFor(fileId);
    try {
      await onSendFileComment(fileId, body);
      setFileDrafts((prev) => ({ ...prev, [fileId]: '' }));
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to send comment');
    } finally {
      setSendingFor(null);
    }
  }

  return (
    <Card title="Activity" style={CARD_STYLE} styles={CARD_BODY_STYLES}>
      <Space direction="vertical" size={14} style={{ width: '100%' }}>
        {feed.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={<Text style={{ color: 'rgba(255,255,255,0.45)' }}>No activity yet</Text>}
          />
        ) : (
          feed.map((entry) => {
            if (entry.kind === 'status') {
              return <StatusLine key={`status-${entry.at}-${entry.change.to}`} change={entry.change} />;
            }
            if (entry.kind === 'comment') {
              return (
                <CommentBlock key={entry.comment.id} comment={entry.comment} supplierName={supplierName} />
              );
            }
            const file = entry.file;
            const showThumbnail = file.downloadUrl && isImageFileName(file.fileName);
            return (
              <div
                key={file.id}
                style={{
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 8,
                  padding: '10px 12px',
                  background: 'rgba(255,255,255,0.03)',
                }}
              >
                <Space size={8} wrap>
                  {file.category && (
                    <Tag style={{ marginInlineEnd: 0 }}>{file.category}</Tag>
                  )}
                  {file.downloadUrl ? (
                    <a href={file.downloadUrl} download style={{ color: '#fff' }}>
                      <Space size={4}>
                        <PaperClipOutlined />
                        {file.fileName}
                        <DownloadOutlined />
                      </Space>
                    </a>
                  ) : (
                    <Text style={{ color: 'rgba(255,255,255,0.9)' }}>{file.fileName}</Text>
                  )}
                </Space>
                <div style={{ marginTop: 4 }}>
                  <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12 }}>
                    {file.uploadedByLabel ?? (file.uploadedByKind === 'staff' ? 'BeastMode' : 'Supplier')}
                    {' — '}
                    {formatCommentWhen(file.createdAt)}
                  </Text>
                </div>

                {/* Test prints and layouts render inline — the point of the
                    feed is commenting directly on what arrived. */}
                {showThumbnail && (
                  <a href={file.downloadUrl!} target="_blank" rel="noopener noreferrer">
                    {/* Signed S3 URLs — plain img is the customer-surface convention. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={file.downloadUrl!}
                      alt={file.fileName}
                      style={{
                        display: 'block',
                        maxWidth: 260,
                        maxHeight: 260,
                        width: '100%',
                        objectFit: 'contain',
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: 6,
                        marginTop: 8,
                      }}
                    />
                  </a>
                )}

                {file.comments.length > 0 && (
                  <div style={{ marginTop: 10, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 8 }}>
                    <Space direction="vertical" size={8} style={{ width: '100%' }}>
                      {file.comments.map((comment) => (
                        <CommentBlock key={comment.id} comment={comment} supplierName={supplierName} />
                      ))}
                    </Space>
                  </div>
                )}

                {onSendFileComment && (
                  <Space.Compact style={{ width: '100%', marginTop: 8 }}>
                    <Input
                      size="small"
                      maxLength={2000}
                      placeholder="Comment on this file…"
                      aria-label={`Comment on ${file.fileName}`}
                      value={fileDrafts[file.id] ?? ''}
                      onChange={(e) =>
                        setFileDrafts((prev) => ({ ...prev, [file.id]: e.target.value }))
                      }
                      onPressEnter={() => void sendFileComment(file.id)}
                      disabled={sendingFor !== null}
                    />
                    <Button
                      size="small"
                      icon={<SendOutlined />}
                      aria-label={`Send comment on ${file.fileName}`}
                      loading={sendingFor === file.id}
                      disabled={!(fileDrafts[file.id] ?? '').trim()}
                      onClick={() => void sendFileComment(file.id)}
                    />
                  </Space.Compact>
                )}
              </div>
            );
          })
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
