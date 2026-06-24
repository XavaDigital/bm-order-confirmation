'use client';

import { useState } from 'react';
import { Upload, Image, Button, Space, message, Popconfirm, Typography, Input } from 'antd';
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
  const [images, setImages] = useState<MockupImage[]>(initialImages);
  const [uploading, setUploading] = useState(false);
  const [editingCaption, setEditingCaption] = useState<Record<string, string>>({});

  async function handleUpload(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const cap = editingCaption['pending'] ?? '';
      if (cap) form.append('caption', cap);

      const res = await fetch(
        `/api/admin/orders/${orderId}/garments/${garmentId}/images`,
        { method: 'POST', body: form },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? 'Upload failed');
      }
      const img: MockupImage & { url: string } = await res.json();
      setImages((prev) => [...prev, img]);
      setEditingCaption((prev) => {
        const next = { ...prev };
        delete next['pending'];
        return next;
      });
      message.success('Image uploaded');
    } catch (err: unknown) {
      message.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
    // Return false to prevent antd default upload behaviour
    return false;
  }

  async function deleteImage(img: MockupImage) {
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
    }
  }

  // antd Upload beforeUpload — intercept and handle manually
  const beforeUpload = (file: UploadFile) => {
    handleUpload(file as unknown as File);
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
                >
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
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
          disabled={uploading}
        >
          <Button
            size="small"
            icon={<UploadOutlined />}
            loading={uploading}
          >
            Upload image
          </Button>
        </Upload>
      </Space>
    </Space>
  );
}
