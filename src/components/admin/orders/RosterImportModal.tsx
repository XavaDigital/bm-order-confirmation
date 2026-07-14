'use client';

import { useMemo, useState } from 'react';
import { Modal, Upload, Button, Table, Select, App, Typography, Alert, Space, Tag } from 'antd';
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

interface AmbiguousDuplicate {
  name: string;
  existingNumber: string | null;
  existingEmail: string | null;
  newNumber: string | null;
  newEmail: string | null;
}

type DuplicateResolution = 'importAll' | 'skipAmbiguous';

interface Props {
  orderId: string;
  open: boolean;
  onClose: () => void;
  /** Called after a successful import so the parent can refresh the roster list. */
  onImported: () => void;
}

const EMPTY_MAPPING: GuessedMapping = { nameColumn: null, playerNumberColumn: null, emailColumn: null };

/** Same non-blank number or same non-blank email (case-insensitive) — mirrors the server's confirmed-duplicate check. */
function rowsAreConfirmedDuplicates(
  a: { number: string | null; email: string | null },
  b: { number: string | null; email: string | null },
): boolean {
  const numberMatch = !!a.number && !!b.number && a.number.toLowerCase() === b.number.toLowerCase();
  const emailMatch = !!a.email && !!b.email && a.email.toLowerCase() === b.email.toLowerCase();
  return numberMatch || emailMatch;
}

/** Groups of previewed row indexes (by position in `previewRows`) that look like the same person entered twice. */
function findVisibleDuplicateRows(previewRows: string[][], mapping: GuessedMapping): number[][] {
  if (mapping.nameColumn === null) return [];
  const nameCol = mapping.nameColumn;
  const seen: { key: string; number: string | null; email: string | null; rowIndex: number }[] = [];
  const groups: number[][] = [];

  previewRows.forEach((row, i) => {
    const name = (row[nameCol] ?? '').trim();
    if (!name) return;
    const number = mapping.playerNumberColumn !== null ? (row[mapping.playerNumberColumn] ?? '').trim() || null : null;
    const email = mapping.emailColumn !== null ? (row[mapping.emailColumn] ?? '').trim() || null : null;
    const key = name.toLowerCase();

    const match = seen.find((s) => s.key === key && rowsAreConfirmedDuplicates(s, { number, email }));
    if (match) {
      const group = groups.find((g) => g.includes(match.rowIndex));
      if (group) group.push(i);
      else groups.push([match.rowIndex, i]);
    }
    seen.push({ key, number, email, rowIndex: i });
  });

  return groups;
}

export function RosterImportModal({ orderId, open, onClose, onImported }: Props) {
  const { message } = App.useApp();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [mapping, setMapping] = useState<GuessedMapping>(EMPTY_MAPPING);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ambiguous, setAmbiguous] = useState<AmbiguousDuplicate[] | null>(null);

  function reset() {
    setFile(null);
    setPreview(null);
    setMapping(EMPTY_MAPPING);
    setError(null);
    setAmbiguous(null);
  }

  function updateMapping(patch: Partial<GuessedMapping>) {
    setMapping((m) => ({ ...m, ...patch }));
    setAmbiguous(null); // a changed mapping invalidates the last duplicate check
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

  async function runImport(resolution?: DuplicateResolution) {
    if (!file || mapping.nameColumn === null) {
      message.error('Choose a column for Name');
      return;
    }
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('mapping', JSON.stringify(mapping));
      if (resolution) fd.append('duplicateResolution', resolution);
      const res = await fetch(`/api/admin/orders/${orderId}/roster/import/commit`, {
        method: 'POST',
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Import failed');

      if (data.needsConfirmation) {
        setAmbiguous(data.ambiguousDuplicates ?? []);
        return;
      }

      const skippedParts: string[] = [];
      if (data.skippedDuplicate) skippedParts.push(`${data.skippedDuplicate} duplicate`);
      if (data.skippedAmbiguous) skippedParts.push(`${data.skippedAmbiguous} possible duplicate`);
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

  const visibleDuplicateGroups = useMemo(
    () => (preview ? findVisibleDuplicateRows(preview.previewRows, mapping) : []),
    [preview, mapping],
  );
  const duplicateRepeatRows = useMemo(() => {
    const s = new Set<number>();
    visibleDuplicateGroups.forEach((group) => group.slice(1).forEach((idx) => s.add(idx)));
    return s;
  }, [visibleDuplicateGroups]);

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
              Include a column for <strong>Name</strong> (required). <strong>Number</strong> and{' '}
              <strong>Email</strong> are optional. Column headers and order don&apos;t matter — you&apos;ll confirm
              the mapping next.
            </p>
          </Upload.Dragger>
        )}

        {!preview && (
          <Typography.Text type="secondary">
            Not sure where to start?{' '}
            <a href="/templates/team-roster-template.csv" download>
              Download a blank template
            </a>
            .
          </Typography.Text>
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
                  onChange={(v) => updateMapping({ nameColumn: v })}
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
                  onChange={(v) => updateMapping({ playerNumberColumn: v ?? null })}
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
                  onChange={(v) => updateMapping({ emailColumn: v ?? null })}
                />
              </div>
            </Space>

            {visibleDuplicateGroups.length > 0 && (
              <Alert
                type="warning"
                showIcon
                message={`${duplicateRepeatRows.size} row${duplicateRepeatRows.size === 1 ? '' : 's'} in this preview look like the same person entered twice`}
                description="Same name and same number or email — only one copy of each (marked below) will be imported, the rest are skipped automatically."
              />
            )}

            <Table
              size="small"
              pagination={false}
              scroll={{ x: true }}
              rowKey={(record) => record.key}
              dataSource={preview.previewRows.map((row, i) => ({ key: i, cells: row }))}
              columns={preview.headers.map((h, i) => ({
                key: i,
                title: h || `Column ${i + 1}`,
                render: (_: unknown, record: { cells: string[]; key: number }) => (
                  <>
                    {record.cells[i] ?? ''}
                    {i === mapping.nameColumn && duplicateRepeatRows.has(record.key) && (
                      <Tag color="warning" style={{ marginLeft: 8 }}>
                        Duplicate
                      </Tag>
                    )}
                  </>
                ),
              }))}
            />

            {ambiguous && ambiguous.length > 0 ? (
              <Alert
                type="warning"
                showIcon
                message={`${ambiguous.length} name${ambiguous.length === 1 ? '' : 's'} match an existing entry, but details differ`}
                description={
                  <Space direction="vertical" style={{ width: '100%' }} size={12}>
                    <Typography.Text>
                      These could be two different people who share a name, or the same person listed twice. Nothing
                      has been imported yet — review below, then choose how to handle them:
                    </Typography.Text>
                    <ul style={{ margin: 0, paddingLeft: 20 }}>
                      {ambiguous.map((d, i) => (
                        <li key={i}>
                          <strong>{d.name}</strong> — existing: {d.existingNumber ?? 'no number'} /{' '}
                          {d.existingEmail ?? 'no email'}; this file: {d.newNumber ?? 'no number'} /{' '}
                          {d.newEmail ?? 'no email'}
                        </li>
                      ))}
                    </ul>
                    <Space>
                      <Button size="small" type="primary" loading={importing} onClick={() => runImport('importAll')}>
                        Import as separate people
                      </Button>
                      <Button size="small" loading={importing} onClick={() => runImport('skipAmbiguous')}>
                        Skip these rows
                      </Button>
                    </Space>
                  </Space>
                }
              />
            ) : (
              <Space>
                <Button
                  type="primary"
                  loading={importing}
                  disabled={mapping.nameColumn === null}
                  onClick={() => runImport()}
                >
                  Import {preview.totalRows} row{preview.totalRows === 1 ? '' : 's'}
                </Button>
                <Button onClick={reset} disabled={importing}>
                  Choose a different file
                </Button>
              </Space>
            )}
          </>
        )}
      </Space>
    </Modal>
  );
}
