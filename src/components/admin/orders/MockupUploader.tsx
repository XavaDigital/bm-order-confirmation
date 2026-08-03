'use client';

import { useRef, useState } from 'react';
import { Upload, Image, Button, Space, App, Popconfirm, Typography, Input } from 'antd';
import {
  UploadOutlined,
  DeleteOutlined,
  EditOutlined,
  PictureOutlined,
} from '@ant-design/icons';
import type { UploadFile } from 'antd';
import { deleteJson, patchJson, postForm } from '@/lib/api-fetch';
import { SEMANTIC } from '@/lib/semantic-colors';

export interface MockupImage {
  id: string;
  storageKey: string;
  caption: string | null;
  sortOrder: number;
  url: string; // signed URL pre-generated server-side
}

interface Props {
  orderId: string;
  garmentId: string;
  initialImages: MockupImage[];
}

/**
 * Captions are added/edited AFTER upload, per image (David, 2026-08-03) —
 * the old type-a-caption-then-upload flow applied one caption to a whole
 * batch and couldn't be corrected without re-uploading.
 */
export function MockupUploader({ orderId, garmentId, initialImages }: Props) {
  const { message } = App.useApp();
  const [images, setImages] = useState<MockupImage[]>(initialImages);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  /** Image id being caption-edited → the in-progress text. */
  const [captionEdit, setCaptionEdit] = useState<{ id: string; text: string } | null>(null);
  const [captionSaving, setCaptionSaving] = useState(false);

  // Collect all files from a single file-picker selection before uploading
  const pendingBatch = useRef<File[]>([]);
  const batchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function handleBatchUpload(files: File[]) {
    setUploadingCount((c) => c + files.length);
    const results = await Promise.allSettled(
      files.map(async (file) => {
        const form = new FormData();
        form.append('file', file);
        return postForm<MockupImage & { url: string }>(
          `/api/admin/orders/${orderId}/garments/${garmentId}/images`,
          form,
          'Upload failed',
        );
      }),
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<MockupImage & { url: string }>[];
    const failedCount = results.filter((r) => r.status === 'rejected').length;

    if (succeeded.length > 0) {
      setImages((prev) => [...prev, ...succeeded.map((r) => r.value)]);
      message.success(succeeded.length === 1 ? 'Image uploaded' : `${succeeded.length} images uploaded`);
    }
    if (failedCount > 0) {
      const firstError = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      const reason =
        firstError?.reason instanceof Error && firstError.reason.message !== 'Upload failed'
          ? ` — ${firstError.reason.message}`
          : '';
      message.error(
        (failedCount === 1 ? 'Failed to upload 1 image' : `Failed to upload ${failedCount} images`) +
          reason,
      );
    }

    setUploadingCount((c) => c - files.length);
  }

  async function deleteImage(img: MockupImage) {
    setDeletingId(img.id);
    try {
      await deleteJson(
        `/api/admin/orders/${orderId}/garments/${garmentId}/images/${img.id}`,
        undefined,
        'Delete failed',
      );
      setImages((prev) => prev.filter((i) => i.id !== img.id));
      message.success('Image removed');
    } catch {
      message.error('Failed to remove image');
    } finally {
      setDeletingId(null);
    }
  }

  async function saveCaption() {
    if (!captionEdit) return;
    setCaptionSaving(true);
    try {
      const { caption } = await patchJson<{ id: string; caption: string | null }>(
        `/api/admin/orders/${orderId}/garments/${garmentId}/images/${captionEdit.id}`,
        { caption: captionEdit.text.trim() || null },
        'Failed to save the caption',
      );
      setImages((prev) => prev.map((i) => (i.id === captionEdit.id ? { ...i, caption } : i)));
      setCaptionEdit(null);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to save the caption');
    } finally {
      setCaptionSaving(false);
    }
  }

  // beforeUpload fires synchronously for each file in the selection.
  // Collect into a batch, then upload all at once after the current tick.
  const beforeUpload = (file: UploadFile) => {
    pendingBatch.current.push(file as unknown as File);
    if (!batchTimer.current) {
      batchTimer.current = setTimeout(() => {
        const files = [...pendingBatch.current];
        pendingBatch.current = [];
        batchTimer.current = null;
        handleBatchUpload(files);
      }, 0);
    }
    return false;
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      {images.length > 0 && (
        <Image.PreviewGroup>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {images.map((img) => (
              <div
                key={img.id}
                style={{
                  position: 'relative',
                  width: 120,
                  textAlign: 'center',
                }}
              >
                <Image
                  src={img.url}
                  alt={img.caption ?? 'Mock-up image'}
                  width={120}
                  height={90}
                  style={{ objectFit: 'cover', borderRadius: 4, border: '1px solid var(--ant-color-border)' }}
                  preview={{ src: img.url }}
                  fallback="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='90'%3E%3Crect width='120' height='90' fill='%23333'/%3E%3C/svg%3E"
                />
                {captionEdit?.id === img.id ? (
                  <Input
                    size="small"
                    autoFocus
                    value={captionEdit.text}
                    maxLength={300}
                    disabled={captionSaving}
                    onChange={(e) => setCaptionEdit({ id: img.id, text: e.target.value })}
                    onPressEnter={() => void saveCaption()}
                    onBlur={() => void saveCaption()}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setCaptionEdit(null);
                    }}
                    placeholder="Caption"
                    style={{ marginTop: 2 }}
                  />
                ) : (
                  <Button
                    type="text"
                    size="small"
                    onClick={() => setCaptionEdit({ id: img.id, text: img.caption ?? '' })}
                    aria-label={img.caption ? `Edit caption: ${img.caption}` : 'Add caption'}
                    style={{
                      marginTop: 2,
                      width: '100%',
                      height: 'auto',
                      padding: '0 2px',
                      fontSize: 11,
                      color: 'var(--ant-color-text-secondary)',
                      whiteSpace: 'normal',
                    }}
                  >
                    {img.caption ? (
                      <Typography.Text type="secondary" style={{ fontSize: 11 }} ellipsis>
                        {img.caption} <EditOutlined />
                      </Typography.Text>
                    ) : (
                      <Typography.Text type="secondary" style={{ fontSize: 11 }} italic>
                        <EditOutlined /> Add caption
                      </Typography.Text>
                    )}
                  </Button>
                )}
                <Popconfirm
                  title="Remove this image?"
                  onConfirm={() => deleteImage(img)}
                  okText="Remove"
                  okType="danger"
                  disabled={deletingId !== null}
                >
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    loading={deletingId === img.id}
                    disabled={deletingId !== null && deletingId !== img.id}
                    style={{
                      position: 'absolute',
                      top: 2,
                      right: 2,
                      background: 'rgba(0,0,0,0.55)',
                      color: SEMANTIC.error,
                    }}
                  />
                </Popconfirm>
              </div>
            ))}
          </div>
        </Image.PreviewGroup>
      )}

      {images.length === 0 && (
        <div
          style={{
            padding: '16px 0',
            textAlign: 'center',
            color: 'var(--ant-color-text-quaternary)',
          }}
        >
          <PictureOutlined style={{ fontSize: 24 }} />
          <div style={{ marginTop: 4 }}>No mock-ups uploaded yet</div>
        </div>
      )}

      <Upload
        showUploadList={false}
        beforeUpload={beforeUpload}
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple
      >
        <Button
          size="small"
          icon={<UploadOutlined />}
          loading={uploadingCount > 0}
        >
          {uploadingCount > 1 ? `Uploading ${uploadingCount}…` : 'Upload images'}
        </Button>
      </Upload>
    </Space>
  );
}
