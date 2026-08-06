'use client';

/**
 * Production files on one purchase order (David, 2026-08-05): layouts, test
 * prints and production layouts travelling between staff and the supplier.
 *
 * Files are grouped by category, oldest first within each group with v1/v2/…
 * counters, so the test-print progression reads at a glance. Each file shows
 * who uploaded it, when, and the PO's status AT UPLOAD TIME (poStatusMeta
 * chip) — the file's place in the production story — plus a shared comment
 * thread the supplier also sees on their portal. Hiding a file soft-deletes it
 * (the stored object is kept forever).
 *
 * Since the 2026-08-06 feedback the PAGE owns the files data (usePoFiles) and
 * passes it in — the Comments rail feed renders the same items, so a comment
 * or an upload on either card refreshes both (the supplier page's pattern).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  App,
  AutoComplete,
  Button,
  Card,
  Input,
  Popconfirm,
  Space,
  Spin,
  Tag,
  Typography,
  Upload,
} from 'antd';
import {
  DeleteOutlined,
  DownloadOutlined,
  PaperClipOutlined,
  SendOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { ApiError, deleteJson, getJson, postForm, postJson } from '@/lib/api-fetch';
import { formatDate } from '@/lib/format';
import { poStatusMeta } from '@/lib/status';
import { PO_FILE_CATEGORIES } from '@/server/purchase-orders/files-contract';

const { Text } = Typography;

const UNCATEGORISED = 'Uncategorised';

/** One comment on a file's thread (OrderNoteDto over the wire). */
interface PoFileComment {
  id: string;
  body: string;
  authorKind: 'staff' | 'email_flow' | 'system' | 'supplier';
  authorName: string | null;
  authorEmail: string | null;
  authorLabel: string | null;
  deleted?: boolean;
  createdAt: string;
}

/** PoFileDto over the wire (createdAt serialised). */
export interface PoFileItem {
  id: string;
  fileName: string;
  contentType: string | null;
  sizeBytes: number | null;
  category: string | null;
  uploadedByKind: 'staff' | 'supplier';
  uploadedByLabel: string | null;
  statusAtUpload: string;
  createdAt: string;
  downloadUrl: string | null;
  comments: PoFileComment[];
}

function commentAuthor(c: PoFileComment): string {
  return c.authorName ?? c.authorEmail ?? c.authorLabel ?? 'Unknown';
}

/**
 * The page-level owner of a PO's production-files data, shared between
 * PoFilesCard (the structured category/version lens) and the Comments rail
 * feed (the chronological lens) so a change in one refreshes the other.
 */
export function usePoFiles(poId: string): {
  items: PoFileItem[] | null;
  loadError: boolean;
  reload: () => Promise<void>;
} {
  const [items, setItems] = useState<PoFileItem[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await getJson<{ items: PoFileItem[] }>(
        `/api/admin/purchase-orders/${poId}/files`,
        'Failed to load production files',
      );
      setItems(res.items);
      setLoadError(false);
    } catch {
      setLoadError(true);
      setItems((prev) => prev ?? []);
    }
  }, [poId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { items, loadError, reload };
}

export interface PoFilesCardProps {
  poId: string;
  /** The page owns the data (usePoFiles) — null = still loading. */
  items: PoFileItem[] | null;
  loadError: boolean;
  /** Called after any mutation (upload / comment / hide) so the page refreshes. */
  onChanged: () => Promise<void>;
}

export function PoFilesCard({ poId, items, loadError, onChanged }: PoFilesCardProps) {
  const { message } = App.useApp();
  const [category, setCategory] = useState('');
  const [uploading, setUploading] = useState(false);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [postingCommentFor, setPostingCommentFor] = useState<string | null>(null);
  const [hidingId, setHidingId] = useState<string | null>(null);

  // Category groups in first-upload order; files inside each stay oldest
  // first (the API serves oldest first), so index+1 is the version number.
  const groups = useMemo(() => {
    const map = new Map<string, PoFileItem[]>();
    for (const f of items ?? []) {
      const key = f.category?.trim() || UNCATEGORISED;
      const bucket = map.get(key);
      if (bucket) bucket.push(f);
      else map.set(key, [f]);
    }
    return [...map.entries()];
  }, [items]);

  async function uploadFile(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const cat = category.trim();
      if (cat) form.append('category', cat);
      await postForm(
        `/api/admin/purchase-orders/${poId}/files`,
        form,
        'Failed to upload the file',
      );
      message.success(`${file.name} uploaded`);
      await onChanged();
    } catch (err) {
      // 503 (storage unconfigured) and 400 (file type/size) carry messages.
      message.error(err instanceof ApiError ? err.message : 'Failed to upload the file');
    } finally {
      setUploading(false);
    }
  }

  async function postComment(file: PoFileItem) {
    const body = (commentDrafts[file.id] ?? '').trim();
    if (!body) return;
    setPostingCommentFor(file.id);
    try {
      await postJson<PoFileComment>(
        `/api/admin/purchase-orders/${poId}/files/${file.id}`,
        { body },
        'Failed to post the comment',
      );
      setCommentDrafts((prev) => ({ ...prev, [file.id]: '' }));
      // Reload rather than patching local state — the Comments rail feed
      // renders the same shared items, so both lenses must see the new comment.
      await onChanged();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to post the comment');
    } finally {
      setPostingCommentFor(null);
    }
  }

  async function hideFile(file: PoFileItem) {
    setHidingId(file.id);
    try {
      await deleteJson(
        `/api/admin/purchase-orders/${poId}/files/${file.id}`,
        undefined,
        'Failed to hide the file',
      );
      message.success(`${file.fileName} hidden`);
      await onChanged();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to hide the file');
    } finally {
      setHidingId(null);
    }
  }

  return (
    <Card
      title="Production files"
      size="small"
      // Same card-title bump as PoDetailView's CARD_STYLES (16px/600) — the
      // page can't reach into this component's Card, so it carries its own.
      styles={{ header: { fontSize: 16, fontWeight: 600 } }}
      extra={
        <a href={`/api/admin/purchase-orders/${poId}/files.zip`}>
          <Button size="small" icon={<DownloadOutlined />} disabled={(items ?? []).length === 0}>
            Download all as ZIP
          </Button>
        </a>
      }
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          Layouts, test prints and production layouts, shared with the supplier on their
          portal. Version counters run per category, oldest first.
        </Text>

        <Space wrap size={8}>
          <AutoComplete
            aria-label="File category"
            options={PO_FILE_CATEGORIES.map((c) => ({ value: c }))}
            value={category}
            onChange={setCategory}
            placeholder="Category — e.g. Test print"
            style={{ width: 220 }}
          />
          <Upload
            showUploadList={false}
            beforeUpload={(file) => {
              void uploadFile(file as unknown as File);
              return false;
            }}
          >
            <Button icon={<UploadOutlined />} loading={uploading}>
              Upload file
            </Button>
          </Upload>
        </Space>

        {loadError && (
          <Alert type="error" showIcon message="Failed to load production files" />
        )}

        {items === null ? (
          <div style={{ textAlign: 'center', padding: 16 }}>
            <Spin />
          </div>
        ) : items.length === 0 ? (
          !loadError && <Text type="secondary">No production files yet.</Text>
        ) : (
          groups.map(([groupName, files]) => (
            <div key={groupName}>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>
                {groupName}
              </Text>
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                {files.map((f, i) => {
                  const status = poStatusMeta(f.statusAtUpload);
                  const comments = f.comments.filter((c) => !c.deleted);
                  return (
                    <div key={f.id}>
                      <Space size={8} wrap>
                        <Tag style={{ marginInlineEnd: 0 }}>v{i + 1}</Tag>
                        {f.downloadUrl ? (
                          <a href={f.downloadUrl} target="_blank" rel="noopener noreferrer">
                            <Space size={4}>
                              <PaperClipOutlined />
                              {f.fileName}
                            </Space>
                          </a>
                        ) : (
                          <Text strong>{f.fileName}</Text>
                        )}
                        <Tag color={status.tag} style={{ marginInlineEnd: 0 }}>
                          {status.label}
                        </Tag>
                        {f.uploadedByKind === 'supplier' && (
                          <Tag color="gold" style={{ marginInlineEnd: 0 }}>
                            Supplier
                          </Tag>
                        )}
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {[f.uploadedByLabel, formatDate(f.createdAt)]
                            .filter(Boolean)
                            .join(' · ')}
                        </Text>
                        <Popconfirm
                          title="Hide this file?"
                          description="It disappears from this list and the supplier portal. The stored file is kept."
                          onConfirm={() => void hideFile(f)}
                          okText="Hide"
                        >
                          <Button
                            size="small"
                            type="text"
                            danger
                            icon={<DeleteOutlined />}
                            loading={hidingId === f.id}
                            aria-label={`Hide ${f.fileName}`}
                          >
                            Hide
                          </Button>
                        </Popconfirm>
                      </Space>
                      {comments.length > 0 && (
                        <div style={{ margin: '6px 0 0 12px' }}>
                          {comments.map((c) => (
                            <div key={c.id} style={{ marginBottom: 4 }}>
                              <Space size={6} wrap>
                                <Text strong style={{ fontSize: 12 }}>
                                  {commentAuthor(c)}
                                </Text>
                                {c.authorKind === 'supplier' && (
                                  <Tag color="gold" style={{ marginInlineEnd: 0 }}>
                                    Supplier
                                  </Tag>
                                )}
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                  {formatDate(c.createdAt)}
                                </Text>
                              </Space>
                              <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{c.body}</div>
                            </div>
                          ))}
                        </div>
                      )}
                      <Space size={6} style={{ marginTop: 6, marginLeft: 12 }}>
                        <Input
                          size="small"
                          maxLength={2000}
                          placeholder="Comment — the supplier sees this"
                          aria-label={`Comment on ${f.fileName}`}
                          value={commentDrafts[f.id] ?? ''}
                          onChange={(e) =>
                            setCommentDrafts((prev) => ({ ...prev, [f.id]: e.target.value }))
                          }
                          onPressEnter={() => void postComment(f)}
                          style={{ width: 320 }}
                        />
                        <Button
                          size="small"
                          icon={<SendOutlined />}
                          loading={postingCommentFor === f.id}
                          disabled={!(commentDrafts[f.id] ?? '').trim()}
                          onClick={() => void postComment(f)}
                          aria-label={`Post comment on ${f.fileName}`}
                        />
                      </Space>
                    </div>
                  );
                })}
              </Space>
            </div>
          ))
        )}
      </Space>
    </Card>
  );
}
