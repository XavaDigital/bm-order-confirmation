'use client';

import { Image, Typography } from 'antd';
import { PictureOutlined } from '@ant-design/icons';

export interface GalleryImage {
  id: string;
  caption: string | null;
  url: string;
}

export function MockupGallery({ images }: { images: GalleryImage[] }) {
  if (images.length === 0) {
    return (
      <div
        style={{
          padding: '24px 0',
          textAlign: 'center',
          color: 'rgba(255,255,255,0.3)',
        }}
      >
        <PictureOutlined style={{ fontSize: 28 }} />
        <div style={{ marginTop: 8, fontSize: 13 }}>No mock-up images</div>
      </div>
    );
  }

  return (
    <Image.PreviewGroup>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {images.map((img) => (
          <div key={img.id} style={{ textAlign: 'center', maxWidth: 160 }}>
            <Image
              src={img.url}
              alt={img.caption ?? 'Mock-up'}
              width={160}
              height={120}
              style={{
                objectFit: 'cover',
                borderRadius: 6,
                border: '1px solid rgba(255,255,255,0.12)',
                cursor: 'pointer',
              }}
              preview={{ src: img.url }}
              fallback="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='120'%3E%3Crect width='160' height='120' fill='%23222'/%3E%3C/svg%3E"
            />
            {img.caption && (
              <Typography.Text
                style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, display: 'block', marginTop: 4 }}
              >
                {img.caption}
              </Typography.Text>
            )}
          </div>
        ))}
      </div>
    </Image.PreviewGroup>
  );
}
