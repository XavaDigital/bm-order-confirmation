'use client';

import { useRef, useState } from 'react';
import { Upload, Image, Button, Space, App, Popconfirm, Typography, Input } from 'antd';
import {
  UploadOutlined,
  DeleteOutlined,
  PictureOutlined,
} from '@ant-design/icons';
import type { UploadFile } from 'antd';

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

export function MockupUploader({ orderId, garmentId, initialImages }: Props) {
  const { message } = App.useApp();
  const [images, setImages] = useState<MockupImage[]>(initialImages);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingCaption, setEditingCaption] = useState<Record<string, string>>({});

  // Collect all files from a single file-picker selection before uploading
  const pendingBatch = useRef<File[]>([]);
  const batchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function handleBatchUpload(files: File[], caption: string) {
    setUploadingCount((c) => c + files.length);
    const results = await Promise.allSettled(
      files.map(async (file) => {
        const form = new FormData();
        form.append('file', file);
        if (caption) form.append('caption', caption);
        const res = await fetch(
          `/api/admin/orders/${orderId}/garments/${garmentId}/images`,
          { method: 'POST', body: form },
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? 'Upload failed');
        }
        return res.json() as Promise<MockupImage & { url: string }>;
      }),
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<MockupImage & { url: string }>[];
    const failedCount = results.filter((r) => r.status === 'rejected').length;

    if (succeeded.length > 0) {
      setImages((prev) => [...prev, ...succeeded.map((r) => r.value)]);
      setEditingCaption((prev) => { const next = { ...prev }; delete next['pending']; return next; });
      message.success(succeeded.length === 1 ? 'Image uploaded' : `${succeeded.length} images uploaded`);
    }
    if (failedCount > 0) {
      message.error(failedCount === 1 ? 'Failed to upload 1 image' : `Failed to upload ${failedCount} images`);
    }

    setUploadingCount((c) => c - files.length);
  }

  async function deleteImage(img: MockupImage) {
    setDeletingId(img.id);
    try {
      const res = await fetch(
        `/api/admin/orders/${orderId}/garments/${garmentId}/images/${img.id}`,
        { method: 'DELETE' },
      );
      if (!res.ok) throw new Error('Delete failed');
      setImages((prev) => prev.filter((i) => i.id !== img.id));
      message.success('Image removed');
    } catch {
      message.error('Failed to remove image');
    } finally {
      setDeletingId(null);
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
        handleBatchUpload(files, editingCaption['pending'] ?? '');
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
                {img.caption && (
                  <Typography.Text
                    type="secondary"
                    style={{ fontSize: 11, display: 'block', marginTop: 2 }}
                    ellipsis
                  >
                    {img.caption}
                  </Typography.Text>
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
                      color: '#ff4d4f',
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

      <Space>
        <Input
          size="small"
          placeholder="Caption (optional)"
          value={editingCaption['pending'] ?? ''}
          onChange={(e) =>
            setEditingCaption((prev) => ({ ...prev, pending: e.target.value }))
          }
          style={{ width: 180 }}
        />
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
    </Space>
  );
}
