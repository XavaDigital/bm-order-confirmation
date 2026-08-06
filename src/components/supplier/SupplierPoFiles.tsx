'use client';

/**
 * The "Files" card on the supplier PO detail page (David, 2026-08-05):
 * production files grouped by category (Layout, Test print, Production
 * layout…), oldest first WITHIN a category — a later upload in the same
 * category IS the newer version, so each file carries a v1/v2 counter. Every
 * file shows who uploaded it, when, and the PO status it arrived in (the
 * progression record), a signed download link, plus upload and
 * everything-as-a-zip.
 *
 * Since the 2026-08-06 feedback this card is the STRUCTURED lens only —
 * category/version at a glance. The chronological lens (and the per-file
 * comment threads) lives in SupplierActivityFeed; the page owns the files
 * data and passes it to both so a comment or upload refreshes each.
 *
 * Upload REQUIRES a category (server 400s without one) — the control stays
 * disabled until one is picked or typed, and a slipped-through 400 surfaces
 * the server's own message.
 */
import { useState } from 'react';
import { App, AutoComplete, Button, Card, Empty, Input, Space, Spin, Tag, Typography, Upload } from 'antd';
import {
  DownloadOutlined,
  FileZipOutlined,
  PaperClipOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { postForm } from '@/lib/api-fetch';
import { poStatusMeta } from '@/lib/status';
import { CARD_STYLE, CARD_BODY_STYLES, FIELD_LABEL_STYLE } from '@/components/customer/customerStyles';
import { formatCommentWhen } from './po-view-helpers';
// The shared category vocabulary — one list with the admin card, so the two
// surfaces cannot drift (David, 2026-08-06).
import { PO_FILE_CATEGORIES } from '@/server/purchase-orders/files-contract';
import { formatFileSize, groupPoFiles } from './po-files-helpers';

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
  /** The page owns the files data (shared with the activity feed). Null = loading. */
  items: PoFileItem[] | null;
  /** Called after a successful upload so the page can refresh the shared data. */
  onUploaded: () => Promise<void>;
}

export function SupplierPoFiles({ code, poNumber, items, onUploaded }: SupplierPoFilesProps) {
  const { message } = App.useApp();
  const base = `/api/supplier/${encodeURIComponent(code)}/po/${encodeURIComponent(poNumber)}`;

  const [category, setCategory] = useState('');
  const [uploading, setUploading] = useState(false);

  const categoryMissing = !category.trim();

  async function upload(file: File) {
    if (categoryMissing) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('category', category.trim());
      await postForm(`${base}/files`, form, 'Failed to upload the file');
      message.success(`${file.name} uploaded`);
      setCategory('');
      await onUploaded();
    } catch (err) {
      // A 400 (missing category) or 503 (storage) carries the server's message.
      message.error(err instanceof Error ? err.message : 'Failed to upload the file');
    } finally {
      setUploading(false);
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
                options={PO_FILE_CATEGORIES.map((s) => ({ value: s }))}
                style={{ width: 200 }}
                disabled={uploading}
              >
                <Input placeholder="Category (required)" maxLength={100} />
              </AutoComplete>
              <Upload
                showUploadList={false}
                disabled={uploading || categoryMissing}
                customRequest={({ file }) => {
                  void upload(file as File);
                }}
              >
                <Button icon={<UploadOutlined />} loading={uploading} disabled={categoryMissing}>
                  Choose file & upload
                </Button>
              </Upload>
            </Space>
            {categoryMissing && (
              <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, display: 'block', marginTop: 4 }}>
                Pick or type a category first — e.g. Layout, Test print.
              </Text>
            )}
          </div>
        </Space>
      )}
    </Card>
  );
}
