'use client';

/**
 * The "Files" card on the supplier PO detail page (David, 2026-08-05):
 * production files grouped by category (Layout, Test print, Production
 * layout…), oldest first WITHIN a category — a later upload in the same
 * category IS the newer version, so each file carries a v1/v2 counter. Every
 * file shows who uploaded it, when, and the PO status it arrived in (the
 * progression record), a signed download link, and its own comment thread
 * ("change this, because…"). Plus upload, and everything-as-a-zip.
 *
 * Self-contained: fetches GET /api/supplier/[code]/po/[poNumber]/files itself
 * so the PO view only has to mount it.
 */
import { useCallback, useEffect, useState } from 'react';
import { App, AutoComplete, Button, Card, Empty, Input, Space, Spin, Tag, Typography, Upload } from 'antd';
import {
  DownloadOutlined,
  FileZipOutlined,
  PaperClipOutlined,
  SendOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { ApiError, getJson, postForm, postJson } from '@/lib/api-fetch';
import { poStatusMeta } from '@/lib/status';
import { CARD_STYLE, CARD_BODY_STYLES, FIELD_LABEL_STYLE } from '@/components/customer/customerStyles';
import { formatCommentWhen } from './po-view-helpers';
import { PO_FILE_CATEGORY_SUGGESTIONS, formatFileSize, groupPoFiles } from './po-files-helpers';

const { Text } = Typography;

/** PoFileDto as it arrives over JSON — dates serialize to strings. */
export interface PoFileItem {
  id: string;
  fileName: string;
  sizeBytes: number | null;
  category: string | null;
  uploadedByKind: 'staff' | 'supplier';
  uploadedByLabel: string | null;
  statusAtUpload: string;
  createdAt: string;
  downloadUrl: string | null;
  comments: {
    id: string;
    body: string;
    authorKind: string;
    authorName: string | null;
    authorLabel: string | null;
    createdAt: string;
  }[];
}

export interface SupplierPoFilesProps {
  code: string;
  poNumber: string;
  /** Bubble a 401 up so the page can drop back to the login card. */
  onUnauthorized?: () => void;
}

function commentAuthor(comment: PoFileItem['comments'][number]): string {
  if (comment.authorKind === 'supplier') return comment.authorLabel ?? 'Supplier';
  return comment.authorName ?? comment.authorLabel ?? 'BeastMode';
}

export function SupplierPoFiles({ code, poNumber, onUnauthorized }: SupplierPoFilesProps) {
  const { message } = App.useApp();
  const base = `/api/supplier/${encodeURIComponent(code)}/po/${encodeURIComponent(poNumber)}`;

  const [items, setItems] = useState<PoFileItem[] | null>(null);
  const [category, setCategory] = useState('');
  const [uploading, setUploading] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sendingFor, setSendingFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await getJson<{ items: PoFileItem[] }>(`${base}/files`, 'Failed to load files');
      setItems(data.items);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onUnauthorized?.();
      else setItems([]);
    }
  }, [base, onUnauthorized]);

  useEffect(() => {
    void load();
  }, [load]);

  async function upload(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      if (category.trim()) form.append('category', category.trim());
      await postForm(`${base}/files`, form, 'Failed to upload the file');
      message.success(`${file.name} uploaded`);
      setCategory('');
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to upload the file');
    } finally {
      setUploading(false);
    }
  }

  async function sendComment(fileId: string) {
    const body = (drafts[fileId] ?? '').trim();
    if (!body || sendingFor) return;
    setSendingFor(fileId);
    try {
      await postJson(`${base}/files/${fileId}`, { body }, 'Failed to send comment');
      setDrafts((prev) => ({ ...prev, [fileId]: '' }));
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to send comment');
    } finally {
      setSendingFor(null);
    }
  }

  const groups = items ? groupPoFiles(items) : [];

  return (
    <Card
      title="Files"
      style={CARD_STYLE}
      styles={CARD_BODY_STYLES}
      extra={
        items && items.length > 0 ? (
          // A download, not an API call — a plain link lets the browser save it.
          <Button size="small" icon={<FileZipOutlined />} href={`${base}/files.zip`}>
            Download all as ZIP
          </Button>
        ) : null
      }
    >
      {items === null ? (
        <div style={{ textAlign: 'center', padding: 24 }}>
          <Spin />
        </div>
      ) : (
        <Space direction="vertical" size={18} style={{ width: '100%' }}>
          {items.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <Text style={{ color: 'rgba(255,255,255,0.45)' }}>
                  No production files yet — upload the layout below.
                </Text>
              }
            />
          ) : (
            groups.map((group) => (
              <div key={group.key}>
                <Text style={{ ...FIELD_LABEL_STYLE, display: 'block', marginBottom: 8 }}>
                  {group.label}
                </Text>
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  {group.files.map((file) => (
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
                        {/* Later files in a category are the newer versions —
                            say so explicitly rather than leaving it to order. */}
                        <Tag color={file.version === group.files.length ? 'geekblue' : undefined} style={{ marginInlineEnd: 0 }}>
                          v{file.version}
                        </Tag>
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
                        {formatFileSize(file.sizeBytes) && (
                          <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>
                            {formatFileSize(file.sizeBytes)}
                          </Text>
                        )}
                      </Space>
                      <div style={{ marginTop: 4 }}>
                        <Space size={6} wrap>
                          <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12 }}>
                            {file.uploadedByLabel ?? (file.uploadedByKind === 'staff' ? 'BeastMode' : 'Supplier')}
                            {' — '}
                            {formatCommentWhen(file.createdAt)}
                          </Text>
                          {/* The PO status the file arrived in — the progression
                              David wants readable off the list. */}
                          <Tag color={poStatusMeta(file.statusAtUpload).tag} style={{ marginInlineEnd: 0 }}>
                            during {poStatusMeta(file.statusAtUpload).label}
                          </Tag>
                        </Space>
                      </div>

                      {file.comments.length > 0 && (
                        <div style={{ marginTop: 10, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 8 }}>
                          <Space direction="vertical" size={8} style={{ width: '100%' }}>
                            {file.comments.map((comment) => (
                              <div key={comment.id}>
                                <Space size={6} wrap>
                                  <Text strong style={{ color: 'rgba(255,255,255,0.9)', fontSize: 12 }}>
                                    {commentAuthor(comment)}
                                  </Text>
                                  <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11 }}>
                                    {formatCommentWhen(comment.createdAt)}
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
                                  {comment.body}
                                </Text>
                              </div>
                            ))}
                          </Space>
                        </div>
                      )}

                      <Space.Compact style={{ width: '100%', marginTop: 8 }}>
                        <Input
                          size="small"
                          maxLength={2000}
                          placeholder="Comment on this file…"
                          value={drafts[file.id] ?? ''}
                          onChange={(e) => setDrafts((prev) => ({ ...prev, [file.id]: e.target.value }))}
                          onPressEnter={() => void sendComment(file.id)}
                          disabled={sendingFor !== null}
                        />
                        <Button
                          size="small"
                          icon={<SendOutlined />}
                          loading={sendingFor === file.id}
                          disabled={!(drafts[file.id] ?? '').trim()}
                          onClick={() => void sendComment(file.id)}
                        />
                      </Space.Compact>
                    </div>
                  ))}
                </Space>
              </div>
            ))
          )}

          <div>
            <Text style={{ ...FIELD_LABEL_STYLE, display: 'block', marginBottom: 6 }}>
              Upload a file
            </Text>
            <Space wrap>
              <AutoComplete
                value={category}
                onChange={(value) => setCategory(value)}
                options={PO_FILE_CATEGORY_SUGGESTIONS.map((s) => ({ value: s }))}
                style={{ width: 200 }}
                disabled={uploading}
              >
                <Input placeholder="Category (e.g. Layout)" maxLength={100} />
              </AutoComplete>
              <Upload
                showUploadList={false}
                disabled={uploading}
                customRequest={({ file }) => {
                  void upload(file as File);
                }}
              >
                <Button icon={<UploadOutlined />} loading={uploading}>
                  Choose file & upload
                </Button>
              </Upload>
            </Space>
          </div>
        </Space>
      )}
    </Card>
  );
}
