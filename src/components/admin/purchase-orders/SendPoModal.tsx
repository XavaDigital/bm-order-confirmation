'use client';

/**
 * Send-to-supplier preview modal (David, 2026-08-06: "when we hit send I'd
 * like to see a preview of what we're actually sending… and potentially edit
 * it slightly").
 *
 * Opening fetches GET /send-preview — the exact subject/body the real send
 * composes (same `composeSupplierPoEmail`) plus the attachment NAMES, no
 * bytes. The one edit on offer is the "Message to the supplier" paragraph
 * (messageIntro), which rides POST /send. The server stays the enforcement:
 * a send blocked by the pre-send checklist or a workflow gate comes back as a
 * 409 and its blockers render right here in the modal.
 *
 * The email HTML renders in a sandboxed iframe via srcDoc — it is a complete
 * document (doctype/head/body) and must not inherit the app's styles.
 */
import { useEffect, useState } from 'react';
import { Alert, Button, Input, Modal, Space, Spin, Tag, Typography } from 'antd';
import { MailOutlined, PaperClipOutlined } from '@ant-design/icons';
import { ApiError, getJson, postJson } from '@/lib/api-fetch';

const { Text } = Typography;

interface SendPoPreview {
  to: string;
  toName: string;
  subject: string;
  html: string;
  portalUrl: string;
  attachments: { filename: string }[];
}

export interface SendPoResult {
  ok: true;
  poNumber: string;
  to: string;
  attachmentSummary: { images: number; fonts: number; sizeCharts: number; sizeReduced: boolean };
}

/** The blockers a refused send came back with (409 message + gate details). */
interface SendBlockers {
  message: string;
  items: string[];
}

function blockersFromError(err: unknown): SendBlockers {
  if (err instanceof ApiError) {
    const details = (err.body as { details?: { outstanding?: Array<{ name?: string; slug?: string }> } } | null)
      ?.details;
    return {
      message: err.message,
      items: (details?.outstanding ?? [])
        .map((task) => task.name ?? task.slug ?? '')
        .filter(Boolean),
    };
  }
  return { message: err instanceof Error ? err.message : 'Failed to send purchase order', items: [] };
}

export function SendPoModal({
  open,
  poId,
  revisionNumber,
  onClose,
  onSent,
}: {
  open: boolean;
  poId: string;
  revisionNumber: number;
  onClose: () => void;
  onSent: (result: SendPoResult) => void;
}) {
  const [preview, setPreview] = useState<SendPoPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [intro, setIntro] = useState('');
  const [sending, setSending] = useState(false);
  const [blockers, setBlockers] = useState<SendBlockers | null>(null);

  useEffect(() => {
    if (!open) return;
    // Fresh modal per open — a stale preview from the last PO state misleads.
    setPreview(null);
    setPreviewError(null);
    setIntro('');
    setBlockers(null);
    let cancelled = false;
    getJson<SendPoPreview>(
      `/api/admin/purchase-orders/${poId}/send-preview`,
      'Failed to load the email preview',
    )
      .then((data) => {
        if (!cancelled) setPreview(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setPreviewError(err instanceof Error ? err.message : 'Failed to load the email preview');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, poId]);

  async function confirmSend() {
    setSending(true);
    setBlockers(null);
    try {
      const trimmed = intro.trim();
      const result = await postJson<SendPoResult>(
        `/api/admin/purchase-orders/${poId}/send`,
        trimmed ? { messageIntro: trimmed } : {},
        'Failed to send purchase order',
      );
      onSent(result);
      onClose();
    } catch (err) {
      // 409 (checklist / workflow gate), 503 (email unconfigured) and 500
      // (SMTP) all carry a human-readable message; gate 409s add the list.
      setBlockers(blockersFromError(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal
      title={`Send to supplier — revision ${revisionNumber}`}
      open={open}
      onCancel={onClose}
      width={720}
      footer={[
        <Button key="cancel" onClick={onClose}>
          Cancel
        </Button>,
        <Button
          key="send"
          type="primary"
          icon={<MailOutlined />}
          loading={sending}
          disabled={!preview}
          onClick={() => void confirmSend()}
        >
          Send email
        </Button>,
      ]}
    >
      {previewError && (
        <Alert type="error" showIcon message={previewError} style={{ marginBottom: 12 }} />
      )}
      {!preview && !previewError && (
        <div style={{ textAlign: 'center', padding: 32 }}>
          <Spin />
        </div>
      )}
      {preview && (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div>
            <Text type="secondary">To: </Text>
            <Text strong>
              {preview.toName} &lt;{preview.to}&gt;
            </Text>
          </div>
          <div>
            <Text type="secondary">Subject: </Text>
            <Text strong>{preview.subject}</Text>
          </div>
          <div>
            <Text strong style={{ display: 'block', marginBottom: 4 }}>
              Message to the supplier
            </Text>
            <Input.TextArea
              rows={3}
              maxLength={2000}
              value={intro}
              onChange={(e) => setIntro(e.target.value)}
              placeholder="Optional note added at the top of the email…"
              aria-label="Message to the supplier"
            />
          </div>
          <iframe
            title="Email preview"
            sandbox=""
            srcDoc={preview.html}
            style={{
              width: '100%',
              height: 320,
              border: '1px solid var(--ant-color-border, #d9d9d9)',
              borderRadius: 6,
              background: '#f4f5f7',
            }}
          />
          <div>
            <Text strong style={{ display: 'block', marginBottom: 4 }}>
              Attachments
            </Text>
            <Space size={4} wrap>
              {preview.attachments.map((a) => (
                <Tag key={a.filename} icon={<PaperClipOutlined />} style={{ marginInlineEnd: 0 }}>
                  {a.filename}
                </Tag>
              ))}
            </Space>
          </div>
          {blockers && (
            <Alert
              type="error"
              showIcon
              message={blockers.message}
              description={
                blockers.items.length > 0 ? (
                  <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                    {blockers.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : undefined
              }
            />
          )}
        </Space>
      )}
    </Modal>
  );
}
