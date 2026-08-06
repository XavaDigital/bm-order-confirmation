'use client';

/**
 * Paste-based import for the garment sizing table (David, 2026-08-06). Staff
 * paste rows copied from Excel / Google Sheets (TSV) or CSV text; the modal
 * parses client-side (sizing-paste-import.ts), lets them adjust the
 * column→field mapping, previews the result, and hands the rows back to
 * SizingTable to fill in — append or replace. Nothing is persisted here; the
 * table's normal "Save sizing" path does that.
 */
import { useMemo, useState } from 'react';
import { Alert, Checkbox, Input, Modal, Segmented, Select, Space, Table, Typography } from 'antd';
import type { ColumnType } from 'antd/es/table';
import type { GarmentTypeOption } from '@/db/schema';
import {
  buildImportedRows,
  detectDelimiter,
  guessColumnTargets,
  looksLikeHeaderRow,
  parseDelimited,
  targetLabel,
  type ImportTarget,
  type ImportedSizingRow,
} from './sizing-paste-import';

const { Text } = Typography;

export type ImportMode = 'append' | 'replace';

interface Props {
  open: boolean;
  /** The garment's custom sizing columns — offered as mapping targets. */
  sizingColumns: GarmentTypeOption[];
  /** Whether the table already has rows — drives the append/replace choice. */
  hasExistingRows: boolean;
  onClose: () => void;
  onImport: (rows: ImportedSizingRow[], mode: ImportMode) => void;
}

const PREVIEW_LIMIT = 8;

export function SizingImportModal({ open, sizingColumns, hasExistingRows, onClose, onImport }: Props) {
  const [text, setText] = useState('');
  /** null = follow the auto guess; true/false = staff flipped the checkbox. */
  const [headerOverride, setHeaderOverride] = useState<boolean | null>(null);
  /** Sparse per-column overrides of the guessed mapping ('' = ignore). */
  const [targetOverrides, setTargetOverrides] = useState<Record<number, ImportTarget | ''>>({});
  const [mode, setMode] = useState<ImportMode>('append');

  const customLabels = useMemo(() => sizingColumns.map((c) => c.label), [sizingColumns]);

  const parsed = useMemo(() => (text.trim() ? parseDelimited(text) : []), [text]);
  const columnCount = parsed.reduce((max, row) => Math.max(max, row.length), 0);
  const autoHasHeaders = looksLikeHeaderRow(parsed[0], customLabels);
  const hasHeaders = headerOverride ?? autoHasHeaders;
  const headers = hasHeaders ? (parsed[0] ?? null) : null;
  const dataRows = hasHeaders ? parsed.slice(1) : parsed;

  const guessedTargets = useMemo(
    () => guessColumnTargets(headers, columnCount, sizingColumns),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- headers derives from parsed+hasHeaders
    [text, hasHeaders, columnCount, sizingColumns],
  );
  const targets: (ImportTarget | null)[] = guessedTargets.map((guess, i) => {
    const override = targetOverrides[i];
    if (override === undefined) return guess;
    return override === '' ? null : override;
  });

  const rows = useMemo(() => buildImportedRows(dataRows, targets), [dataRows, targets]);

  const targetOptions: { value: ImportTarget | ''; label: string }[] = [
    { value: '', label: 'Ignore' },
    { value: 'size', label: 'Size' },
    { value: 'playerName', label: 'Player Name' },
    { value: 'playerNumber', label: 'Number' },
    { value: 'quantity', label: 'Qty' },
    { value: 'notes', label: 'Notes' },
    ...customLabels.map((l): { value: ImportTarget; label: string } => ({
      value: `custom:${l}`,
      label: l,
    })),
  ];

  const mappedTargets = targets.filter((t): t is ImportTarget => t !== null);
  const previewColumns: ColumnType<ImportedSizingRow>[] = mappedTargets.map((target) => ({
    title: targetLabel(target),
    key: target,
    render: (_: unknown, row: ImportedSizingRow) =>
      target.startsWith('custom:')
        ? row.customValues[target.slice('custom:'.length)] ?? ''
        : row[target as Exclude<ImportTarget, `custom:${string}`>],
  }));

  function reset() {
    setText('');
    setHeaderOverride(null);
    setTargetOverrides({});
    setMode('append');
  }

  function confirm() {
    onImport(rows, hasExistingRows ? mode : 'append');
    reset();
  }

  return (
    <Modal
      title="Import sizing rows"
      open={open}
      onCancel={() => {
        reset();
        onClose();
      }}
      onOk={confirm}
      okText={`Import ${rows.length} row${rows.length === 1 ? '' : 's'}`}
      okButtonProps={{ disabled: rows.length === 0 }}
      width={720}
      destroyOnHidden
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Text type="secondary" style={{ fontSize: 13 }}>
          Paste rows copied from Excel or Google Sheets (or CSV text). Map each column below,
          check the preview, then import — rows land in the table unsaved, so review them and
          hit &ldquo;Save sizing&rdquo; to keep them.
        </Text>
        <Input.TextArea
          rows={6}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            // A new paste invalidates any per-column tweaks made for the old one.
            setTargetOverrides({});
            setHeaderOverride(null);
          }}
          placeholder={'Size\tPlayer Name\tNumber\nM\tAlice\t7\nL\tBob\t9'}
          aria-label="Pasted sizing rows"
          style={{ fontFamily: 'monospace' }}
        />
        {parsed.length > 0 && (
          <>
            <Space size={16} wrap>
              <Checkbox
                checked={hasHeaders}
                onChange={(e) => {
                  setHeaderOverride(e.target.checked);
                  setTargetOverrides({});
                }}
              >
                First row is headers
              </Checkbox>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Detected {detectDelimiter(text) === '\t' ? 'tab' : 'comma'}-separated ·{' '}
                {dataRows.length} row{dataRows.length === 1 ? '' : 's'}, {columnCount} column
                {columnCount === 1 ? '' : 's'}
              </Text>
            </Space>

            <div>
              <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 6 }}>
                Column mapping
              </Text>
              <Space size={8} wrap>
                {Array.from({ length: columnCount }, (_, i) => (
                  <div key={i}>
                    <Text
                      type="secondary"
                      style={{ fontSize: 11, display: 'block', maxWidth: 140 }}
                      ellipsis
                    >
                      {headers?.[i]?.trim() || `Column ${i + 1}`}
                    </Text>
                    <Select<ImportTarget | ''>
                      size="small"
                      style={{ width: 140 }}
                      value={targets[i] ?? ''}
                      onChange={(v) => setTargetOverrides((prev) => ({ ...prev, [i]: v }))}
                      options={targetOptions}
                      aria-label={`Column ${i + 1} target`}
                    />
                  </div>
                ))}
              </Space>
            </div>

            {rows.length === 0 ? (
              <Alert
                type="warning"
                showIcon
                message="Nothing to import — no pasted row has a value in a mapped column."
              />
            ) : (
              <div>
                <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 6 }}>
                  Preview{rows.length > PREVIEW_LIMIT ? ` (first ${PREVIEW_LIMIT} of ${rows.length})` : ''}
                </Text>
                <Table
                  dataSource={rows.slice(0, PREVIEW_LIMIT).map((r, i) => ({ ...r, key: i }))}
                  columns={previewColumns}
                  size="small"
                  pagination={false}
                />
              </div>
            )}

            {hasExistingRows && rows.length > 0 && (
              <Segmented
                value={mode}
                onChange={(v) => setMode(v as ImportMode)}
                options={[
                  { label: 'Add to existing rows', value: 'append' },
                  { label: 'Replace existing rows', value: 'replace' },
                ]}
              />
            )}
          </>
        )}
      </Space>
    </Modal>
  );
}
