'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import { Tabs, Button, Upload, Typography, Space } from 'antd';
import { ClearOutlined, UploadOutlined } from '@ant-design/icons';

export interface SignatureData {
  dataUrl: string | null;
  type: 'drawn' | 'uploaded' | 'none';
}

interface Props {
  onChange: (sig: SignatureData) => void;
}

export function SignaturePad({ onChange }: Props) {
  const canvasRef = useRef<SignatureCanvas>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 600, height: 180 });
  const [hasDrawn, setHasDrawn] = useState(false);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);

  // Keep canvas internal resolution in sync with its CSS width so coordinates match
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const width = Math.floor(entries[0].contentRect.width);
      if (width > 0) setCanvasSize((prev) => ({ ...prev, width }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function clearCanvas() {
    canvasRef.current?.clear();
    setHasDrawn(false);
    onChange({ dataUrl: null, type: 'none' });
  }

  const onDrawEnd = useCallback(() => {
    if (!canvasRef.current || canvasRef.current.isEmpty()) return;
    setHasDrawn(true);
    // Not using getTrimmedCanvas(): its trim-canvas dependency breaks under Next's
    // webpack ESM/CJS interop, and trimming is a no-op anyway since the canvas has
    // an opaque white background (trim-canvas trims by alpha, which is always 255).
    const dataUrl = canvasRef.current.getCanvas().toDataURL('image/png');
    onChange({ dataUrl, type: 'drawn' });
  }, [onChange]);

  function handleUpload(file: File) {
    if (!file.type.startsWith('image/')) return false;
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setUploadPreview(dataUrl);
      onChange({ dataUrl, type: 'uploaded' });
    };
    reader.readAsDataURL(file);
    return false;
  }

  function onTabChange(key: string) {
    if (key === 'skip') onChange({ dataUrl: null, type: 'none' });
  }

  const tabItems = [
    {
      key: 'draw',
      label: 'Draw signature',
      children: (
        <div>
          <div
            ref={wrapperRef}
            style={{
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 6,
              background: '#fff',
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            <SignatureCanvas
              ref={canvasRef}
              onEnd={onDrawEnd}
              canvasProps={{
                width: canvasSize.width,
                height: canvasSize.height,
                style: { width: '100%', height: canvasSize.height, display: 'block' },
              }}
              penColor="#0B1622"
              backgroundColor="white"
            />
            {!hasDrawn && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  pointerEvents: 'none',
                  color: 'rgba(0,0,0,0.25)',
                  fontSize: 14,
                }}
              >
                Draw your signature here
              </div>
            )}
          </div>
          <Space style={{ marginTop: 8 }}>
            <Button size="small" icon={<ClearOutlined />} onClick={clearCanvas} disabled={!hasDrawn}>
              Clear
            </Button>
          </Space>
        </div>
      ),
    },
    {
      key: 'upload',
      label: 'Upload image',
      children: uploadPreview ? (
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={uploadPreview}
            alt="Uploaded signature"
            style={{
              maxWidth: '100%',
              maxHeight: 180,
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 6,
              background: '#fff',
              display: 'block',
            }}
          />
          <Button
            size="small"
            style={{ marginTop: 8 }}
            onClick={() => {
              setUploadPreview(null);
              onChange({ dataUrl: null, type: 'none' });
            }}
          >
            Remove
          </Button>
        </div>
      ) : (
        <Upload.Dragger
          showUploadList={false}
          beforeUpload={handleUpload}
          accept="image/*"
          style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px dashed rgba(255,255,255,0.25)',
          }}
        >
          <UploadOutlined style={{ fontSize: 24, color: 'rgba(255,255,255,0.4)' }} />
          <div style={{ marginTop: 8, color: 'rgba(255,255,255,0.6)' }}>
            Click or drag an image of your signature
          </div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            JPEG, PNG or WebP accepted
          </Typography.Text>
        </Upload.Dragger>
      ),
    },
    {
      key: 'skip',
      label: 'Skip',
      children: (
        <Typography.Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13 }}>
          No signature will be attached to this confirmation.
        </Typography.Text>
      ),
    },
  ];

  return (
    <Tabs items={tabItems} defaultActiveKey="draw" onChange={onTabChange} />
  );
}
