'use client';

import { useState } from 'react';
import { Modal, Upload, Button, Table, Select, App, Typography, Alert, Space } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import type { UploadProps } from 'antd';

interface GuessedMapping {
  nameColumn: number | null;
  playerNumberColumn: number | null;
  emailColumn: number | null;
}

interface PreviewData {
  headers: string[];
  previewRows: string[][];
  totalRows: number;
  guessedMapping: GuessedMapping;
}

interface Props {
  orderId: string;
  open: boolean;
  onClose: () => void;
  /** Called after a successful import so the parent can refresh the roster list. */
  onImported: () => void;
}

const EMPTY_MAPPING: GuessedMapping = { nameColumn: null, playerNumberColumn: null, emailColumn: null };

export function RosterImportModal({ orderId, open, onClose, onImported }: Props) {
  const { message } = App.useApp();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [mapping, setMapping] = useState<GuessedMapping>(EMPTY_MAPPING);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setFile(null);
    setPreview(null);
    setMapping(EMPTY_MAPPING);
    setError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleFileSelect(selected: File) {
    setFile(selected);
    setPreview(null);
    setError(null);
    setLoadingPreview(true);
    try {
      const fd = new FormData();
      fd.append('file', selected);
      const res = await fetch(`/api/admin/orders/${orderId}/roster/import/preview`, {
        method: 'POST',
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Failed to read file');
      setPreview(data);
      setMapping(data.guessedMapping);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read file');
      setFile(null);
    } finally {
      setLoadingPreview(false);
    }
  }

  async function handleImport() {
    if (!file || mapping.nameColumn === null) {
      message.error('Choose a column for Name');
      return;
    }
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('mapping', JSON.stringify(mapping));
      const res = await fetch(`/api/admin/orders/${orderId}/roster/import/commit`, {
        method: 'POST',
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Import failed');

      const skippedParts: string[] = [];
      if (data.skippedDuplicate) skippedParts.push(`${data.skippedDuplicate} duplicate`);
      if (data.skippedBlank) skippedParts.push(`${data.skippedBlank} blank`);
      message.success(
        `Imported ${data.imported} member${data.imported === 1 ? '' : 's'}` +
          (skippedParts.length > 0 ? ` — skipped ${skippedParts.join(', ')}` : ''),
      );

      onImported();
      handleClose();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  const columnOptions = (preview?.headers ?? []).map((h, i) => ({ label: h || `Column ${i + 1}`, value: i }));

  const beforeUpload: UploadProps['beforeUpload'] = (uploadFile) => {
    void handleFileSelect(uploadFile as unknown as File);
    return false; // prevent antd's default auto-upload — we drive the request ourselves
  };

  return (
    <Modal title="Import team roster" open={open} onCancel={handleClose} footer={null} width={720} destroyOnHidden>
      <Space direction="vertical" style={{ width: '100%' }} size={16}>
        {!preview && (
          <Upload.Dragger
            accept=".csv,.xlsx"
            multiple={false}
            showUploadList={false}
            beforeUpload={beforeUpload}
            disabled={loadingPreview}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">Click or drag a CSV or Excel (.xlsx) file here</p>
            <p className="ant-upload-hint">
              Names, numbers, and emails can be in any column order — you&apos;ll confirm the mapping next.
            </p>
          </Upload.Dragger>
        )}

        {loadingPreview && <Typography.Text type="secondary">Reading file…</Typography.Text>}

        {error && <Alert type="error" showIcon message={error} />}

        {preview && (
          <>
            <Typography.Text type="secondary">
              {preview.totalRows} row{preview.totalRows === 1 ? '' : 's'} detected. Showing the first{' '}
              {preview.previewRows.length}.
            </Typography.Text>

            <Space wrap size={16}>
              <div>
                <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
                  Name column *
                </Typography.Text>
                <Select
                  style={{ width: 180 }}
                  options={columnOptions}
                  value={mapping.nameColumn ?? undefined}
                  placeholder="Select column"
                  onChange={(v) => setMapping((m) => ({ ...m, nameColumn: v }))}
                />
              </div>
              <div>
                <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
                  Number column
                </Typography.Text>
                <Select
                  style={{ width: 180 }}
                  allowClear
                  options={columnOptions}
                  value={mapping.playerNumberColumn ?? undefined}
                  placeholder="None"
                  onChange={(v) => setMapping((m) => ({ ...m, playerNumberColumn: v ?? null }))}
                />
              </div>
              <div>
                <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
                  Email column
                </Typography.Text>
                <Select
                  style={{ width: 180 }}
                  allowClear
                  options={columnOptions}
                  value={mapping.emailColumn ?? undefined}
                  placeholder="None"
                  onChange={(v) => setMapping((m) => ({ ...m, emailColumn: v ?? null }))}
                />
              </div>
            </Space>

            <Table
              size="small"
              pagination={false}
              scroll={{ x: true }}
              rowKey={(record) => record.key}
              dataSource={preview.previewRows.map((row, i) => ({ key: i, cells: row }))}
              columns={preview.headers.map((h, i) => ({
                key: i,
                title: h || `Column ${i + 1}`,
                render: (_: unknown, record: { cells: string[] }) => record.cells[i] ?? '',
              }))}
            />

            <Space>
              <Button
                type="primary"
                loading={importing}
                disabled={mapping.nameColumn === null}
                onClick={handleImport}
              >
                Import {preview.totalRows} row{preview.totalRows === 1 ? '' : 's'}
              </Button>
              <Button onClick={reset} disabled={importing}>
                Choose a different file
              </Button>
            </Space>
          </>
        )}
      </Space>
    </Modal>
  );
}
