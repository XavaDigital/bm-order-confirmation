'use client';

/**
 * Raise a purchase order for an order: pick an active supplier, scope the PO
 * to garments, optionally set dates/notes. Warns (never blocks) when the
 * order is unconfirmed or a colour sample hold is active — staff can still
 * raise the PO through an explicit "Raise PO anyway?" confirmation.
 */
import { useState } from 'react';
import {
  Alert,
  App,
  Button,
  Checkbox,
  DatePicker,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Typography,
} from 'antd';
import type { Dayjs } from 'dayjs';
import { ApiError, postJson } from '@/lib/api-fetch';
import { useAdminResource } from '@/lib/use-admin-resource';

export interface PoModalGarment {
  id: string;
  name: string;
  sizingRowCount: number;
  /** Every sizing row of this garment is already on a live PO. */
  fullyCovered: boolean;
}

interface Supplier {
  id: string;
  name: string;
}

interface CreatedPo {
  id: string;
  poNumber: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  orderId: string;
  orderStatus: string;
  colorSampleRequestedAt: string | null;
  garments: PoModalGarment[];
}

export function CreatePoModal({
  open,
  onClose,
  onCreated,
  orderId,
  orderStatus,
  colorSampleRequestedAt,
  garments,
}: Props) {
  const { message } = App.useApp();
  const { data: suppliers, loading: suppliersLoading } = useAdminResource<Supplier[]>(
    '/api/admin/suppliers?active=1',
    { errorMessage: 'Failed to load suppliers' },
  );
  const [supplierId, setSupplierId] = useState<string | undefined>(undefined);
  const [garmentIds, setGarmentIds] = useState<string[]>([]);
  const [deadlineDate, setDeadlineDate] = useState<Dayjs | null>(null);
  const [expectedShipDate, setExpectedShipDate] = useState<Dayjs | null>(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const unconfirmedWarning = orderStatus !== 'confirmed';
  const colorSampleHold = colorSampleRequestedAt !== null;
  const needsConfirm = unconfirmedWarning || colorSampleHold;

  async function submit() {
    if (!supplierId) {
      message.error('Select a supplier');
      return;
    }
    if (garmentIds.length === 0) {
      message.error('Select at least one garment');
      return;
    }

    setSubmitting(true);
    try {
      const po = await postJson<CreatedPo>(
        '/api/admin/purchase-orders',
        {
          orderId,
          supplierId,
          garmentIds,
          deadlineDate: deadlineDate ? deadlineDate.format('YYYY-MM-DD') : undefined,
          expectedShipDate: expectedShipDate ? expectedShipDate.format('YYYY-MM-DD') : undefined,
          notes: notes.trim() || undefined,
        },
        'Failed to create purchase order',
      );
      message.success(`Purchase order ${po.poNumber} created`);
      onCreated();
    } catch (err) {
      message.error(
        err instanceof ApiError ? err.message : 'Failed to create purchase order',
      );
    } finally {
      setSubmitting(false);
    }
  }

  const submitButton = needsConfirm ? (
    <Popconfirm
      key="submit"
      title="Raise PO anyway?"
      description="The warnings above apply — only proceed if this is intentional."
      onConfirm={submit}
      okText="Raise PO anyway"
    >
      <Button type="primary" loading={submitting}>
        Create purchase order
      </Button>
    </Popconfirm>
  ) : (
    <Button key="submit" type="primary" loading={submitting} onClick={submit}>
      Create purchase order
    </Button>
  );

  return (
    <Modal
      title="Create purchase order"
      open={open}
      onCancel={onClose}
      footer={[
        <Button key="cancel" onClick={onClose}>
          Cancel
        </Button>,
        submitButton,
      ]}
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {unconfirmedWarning && (
          <Alert
            type="warning"
            showIcon
            message="This order has not been confirmed by the customer."
            description="Raising a PO before the customer confirms means the supplier may start on unagreed details."
          />
        )}
        {colorSampleHold && (
          <Alert
            type="error"
            showIcon
            message="Colour sample requested — production is on hold."
            description="The customer asked for a colour book / physical sample. Resolve the colour sample request before releasing this order to production."
          />
        )}

        <div>
          <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
            Supplier
          </Typography.Text>
          <Select
            style={{ width: '100%' }}
            placeholder="Select an active supplier"
            loading={suppliersLoading}
            value={supplierId}
            onChange={setSupplierId}
            showSearch
            optionFilterProp="label"
            options={(suppliers ?? []).map((s) => ({ value: s.id, label: s.name }))}
          />
        </div>

        <div>
          <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
            Garments on this PO
          </Typography.Text>
          <Checkbox.Group
            value={garmentIds}
            onChange={(values) => setGarmentIds(values as string[])}
            style={{ width: '100%' }}
          >
            <Space direction="vertical" size={4}>
              {garments.map((g) => (
                <Checkbox key={g.id} value={g.id}>
                  {g.name} — {g.sizingRowCount} sizing {g.sizingRowCount === 1 ? 'row' : 'rows'}
                  {g.fullyCovered && (
                    <Typography.Text type="secondary" style={{ marginLeft: 6, fontSize: 12 }}>
                      (already covered)
                    </Typography.Text>
                  )}
                </Checkbox>
              ))}
            </Space>
          </Checkbox.Group>
          {garments.length === 0 && (
            <Typography.Text type="secondary">This order has no garments yet.</Typography.Text>
          )}
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
              Deadline
            </Typography.Text>
            <DatePicker
              style={{ width: '100%' }}
              format="DD MMM YYYY"
              value={deadlineDate}
              onChange={setDeadlineDate}
              placeholder="Optional"
            />
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
              Expected ship date
            </Typography.Text>
            <DatePicker
              style={{ width: '100%' }}
              format="DD MMM YYYY"
              value={expectedShipDate}
              onChange={setExpectedShipDate}
              placeholder="Optional"
            />
          </div>
        </div>

        <div>
          <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
            Notes to supplier
          </Typography.Text>
          <Input.TextArea
            rows={3}
            maxLength={2000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional — e.g. shipping instructions, packaging requirements"
            style={{ resize: 'vertical' }}
          />
        </div>
      </Space>
    </Modal>
  );
}
