'use client';

/**
 * Add/edit one custom sizing-table column (Colour, Variation, Sponsor…).
 *
 * The column shape is `GarmentTypeOption` — the same discriminated union the
 * garment-type order options use — so the select-vs-text editor and the cell
 * renderer are shared rather than duplicated.
 */
import { useEffect, useState } from 'react';
import { Form, Input, Modal, Radio, Select, Typography } from 'antd';
import type { GarmentTypeOption } from '@/db/schema';

interface Props {
  open: boolean;
  /** Existing column when editing; null when adding. */
  editing: GarmentTypeOption | null;
  /** Labels already in use on this garment — duplicates are rejected. */
  existingLabels: string[];
  onClose: () => void;
  onSave: (column: GarmentTypeOption) => void;
}

export function SizingColumnModal({ open, editing, existingLabels, onClose, onSave }: Props) {
  const [label, setLabel] = useState('');
  const [type, setType] = useState<'select' | 'text'>('text');
  const [options, setOptions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Re-seed whenever the modal opens so a cancelled edit doesn't leak into the
  // next one (the modal is kept mounted by its parent).
  useEffect(() => {
    if (!open) return;
    setLabel(editing?.label ?? '');
    // Sizing columns don't support the checkbox variant (out of scope — see
    // CHAINED_CONDITIONAL_FIELDS_PLAN.md); fall back to text for that case.
    setType(editing?.type === 'select' ? 'select' : 'text');
    setOptions(editing && editing.type === 'select' ? editing.options : []);
    setError(null);
  }, [open, editing]);

  function save() {
    const trimmed = label.trim();
    if (!trimmed) {
      setError('Give the column a name');
      return;
    }
    const clash = existingLabels.some(
      (l) => l.toLowerCase() === trimmed.toLowerCase() && l !== editing?.label,
    );
    if (clash) {
      setError('A column with that name already exists on this garment');
      return;
    }
    if (type === 'select' && options.length === 0) {
      setError('Add at least one option, or switch to free text');
      return;
    }

    onSave(
      type === 'select'
        ? { label: trimmed, type: 'select', options }
        : { label: trimmed, type: 'text' },
    );
    onClose();
  }

  return (
    <Modal
      open={open}
      title={editing ? `Edit column “${editing.label}”` : 'Add sizing column'}
      onOk={save}
      onCancel={onClose}
      okText={editing ? 'Save column' : 'Add column'}
      destroyOnHidden
    >
      <Form layout="vertical">
        <Form.Item
          label="Column name"
          required
          validateStatus={error ? 'error' : undefined}
          help={error ?? undefined}
        >
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Colour, Variation, Sponsor logo"
            maxLength={80}
            onPressEnter={save}
          />
        </Form.Item>

        <Form.Item label="Type">
          <Radio.Group value={type} onChange={(e) => setType(e.target.value)}>
            <Radio.Button value="text">Free text</Radio.Button>
            <Radio.Button value="select">Pick from a list</Radio.Button>
          </Radio.Group>
        </Form.Item>

        {type === 'select' && (
          <Form.Item
            label="Options"
            extra="Type a value and press Enter. Staff pick one of these per row."
          >
            <Select
              mode="tags"
              value={options}
              onChange={setOptions}
              placeholder="Navy, Red, White…"
              open={false}
              style={{ width: '100%' }}
            />
          </Form.Item>
        )}

        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Columns belong to this garment. Existing values are kept if you rename the
          column, but they stop showing until the name matches again.
        </Typography.Text>
      </Form>
    </Modal>
  );
}
