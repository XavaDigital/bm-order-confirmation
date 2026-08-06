'use client';

/**
 * "Bulk upload" affordance for a "Got Your Back" name-list garment on the
 * customer roster surfaces (David: customers should bulk-upload their order
 * sheet, "we'd need to give them some guidance on what the structure should
 * look like").
 *
 * The guidance IS the feature: a downloadable template with the exact
 * headers, explicit column rules, and a drag-drop that reads the CSV in the
 * browser (bulk-name-list.ts) and hands parsed rows to the caller — which
 * merges them into the draft and saves through the EXISTING name-list route.
 */
import { useState } from 'react';
import { Button, Space, Typography, Upload } from 'antd';
import { DownloadOutlined, InboxOutlined } from '@ant-design/icons';
import {
  BulkNameListError,
  MAX_BULK_FILE_BYTES,
  MAX_NAME_LIST_ENTRIES,
  buildNameListTemplateCsv,
  parseNameListCsv,
  type ParsedNameRow,
} from './bulk-name-list';

const { Text } = Typography;

export interface BulkUploadOutcome {
  added: number;
  duplicates: number;
}

export interface BulkNameListUploadProps {
  garmentName: string;
  disabled?: boolean;
  /**
   * Merge + save the parsed rows (the caller owns the draft and the API
   * call). Returns what happened so the outcome line can report it; throws
   * (e.g. over the 300 cap, or a failed save) to surface the error here.
   */
  onImport: (rows: ParsedNameRow[]) => Promise<BulkUploadOutcome>;
}

function downloadTemplate() {
  try {
    const blob = new Blob([buildNameListTemplateCsv()], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'name-list-template.csv';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  } catch {
    // Blob URLs unavailable (ancient browser) — the guidance text still names
    // the two columns, so the sheet can be built by hand.
  }
}

function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsText(file);
  });
}

export function BulkNameListUpload({ garmentName, disabled, onImport }: BulkNameListUploadProps) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setOutcome(null);
    setError(null);
    if (file.size > MAX_BULK_FILE_BYTES) {
      setError('That file is too large — a name list CSV should be well under 1MB.');
      return;
    }
    setBusy(true);
    try {
      const text = await readFileText(file);
      const parsed = parseNameListCsv(text);
      const result = await onImport(parsed.rows);
      const bits = [`Added ${result.added} name${result.added === 1 ? '' : 's'}`];
      if (result.duplicates > 0) bits.push(`${result.duplicates} already on the list`);
      if (parsed.skippedBlank > 0) bits.push(`${parsed.skippedBlank} blank row${parsed.skippedBlank === 1 ? '' : 's'} ignored`);
      setOutcome(bits.join(' · '));
    } catch (err) {
      setError(
        err instanceof BulkNameListError || err instanceof Error
          ? err.message
          : 'Could not read that file. Please check it against the template.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        border: '1px dashed rgba(255,255,255,0.25)',
        borderRadius: 8,
        padding: 12,
        marginBottom: 12,
        background: 'rgba(255,255,255,0.02)',
      }}
    >
      <Space wrap style={{ marginBottom: 8, justifyContent: 'space-between', width: '100%' }}>
        <Text strong style={{ color: 'rgba(255,255,255,0.85)' }}>
          Bulk upload names
        </Text>
        <Button size="small" icon={<DownloadOutlined />} onClick={downloadTemplate}>
          Download template (CSV)
        </Button>
      </Space>
      <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12, display: 'block', marginBottom: 8 }}>
        Upload your sheet as a <strong>.csv</strong> file (in Excel or Google Sheets: File →
        Download / Save As → CSV). The first row must be headers with a{' '}
        <strong>Name</strong> column (required — exactly as it should print) and optionally a{' '}
        <strong>Number</strong> column. Up to {MAX_NAME_LIST_ENTRIES} names; extra columns are
        ignored, and names already on the list are skipped.
      </Text>
      <Upload.Dragger
        accept=".csv,text/csv"
        multiple={false}
        showUploadList={false}
        disabled={disabled || busy}
        customRequest={() => {
          /* handled in beforeUpload — nothing is ever uploaded to a server from here */
        }}
        beforeUpload={(file) => {
          void handleFile(file as unknown as File);
          return false;
        }}
      >
        <p style={{ margin: '4px 0' }}>
          <InboxOutlined style={{ fontSize: 24, color: 'rgba(255,255,255,0.45)' }} />
        </p>
        <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 13 }}>
          {busy ? 'Importing…' : `Drag your ${garmentName} sheet here, or click to choose a .csv file`}
        </Text>
      </Upload.Dragger>
      {outcome && (
        <Text style={{ color: '#52c41a', fontSize: 12, display: 'block', marginTop: 8 }}>
          {outcome}
        </Text>
      )}
      {error && (
        <Text style={{ color: '#ff7875', fontSize: 12, display: 'block', marginTop: 8 }}>
          {error}
        </Text>
      )}
    </div>
  );
}
