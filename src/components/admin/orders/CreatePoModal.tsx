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
import { formatDate } from '@/lib/format';
import { useAdminResource } from '@/lib/use-admin-resource';
import { ColorBookSelect } from '@/components/admin/purchase-orders/ColorBookSelect';

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
  /**
   * The order's customer deadline — display only. The PO's deadline is copied
   * from it server-side at create; it is never sent from here.
   */
  deadlineDate: string | null;
  garments: PoModalGarment[];
}

export function CreatePoModal({
  open,
  onClose,
  onCreated,
  orderId,
  orderStatus,
  colorSampleRequestedAt,
  deadlineDate,
  garments,
}: Props) {
  const { message } = App.useApp();
  const { data: suppliers, loading: suppliersLoading } = useAdminResource<Supplier[]>(
    '/api/admin/suppliers?active=1',
    { errorMessage: 'Failed to load suppliers' },
  );
  const [supplierId, setSupplierId] = useState<string | undefined>(undefined);
  // The colour book to match against (David, 2026-08-05): defaults to the
  // supplier's newest; the DEFAULT is omitted from the POST so the server
  // resolves it (createPurchaseOrderSchema: omitted = supplier's newest).
  const [colorBookId, setColorBookId] = useState<string | null>(null);
  const [defaultBookId, setDefaultBookId] = useState<string | null>(null);
  const [garmentIds, setGarmentIds] = useState<string[]>([]);
  const [customerRef, setCustomerRef] = useState('');
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
          // Only sent when staff picked a NON-default book — omitted means the
          // server matches against the supplier's newest at create time.
          ...(colorBookId && colorBookId !== defaultBookId ? { colorBookId } : {}),
          // No deadlineDate — the server copies the customer deadline onto the PO.
          ...(customerRef.trim() ? { customerRef: customerRef.trim() } : {}),
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
            onChange={(id) => {
              setSupplierId(id);
              // Books belong to a supplier — a new pick invalidates the old one.
              setColorBookId(null);
              setDefaultBookId(null);
            }}
            showSearch
            optionFilterProp="label"
            options={(suppliers ?? []).map((s) => ({ value: s.id, label: s.name }))}
          />
        </div>

        {supplierId && (
          <div>
            <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
              Colour book
            </Typography.Text>
            <ColorBookSelect
              key={supplierId}
              supplierId={supplierId}
              value={colorBookId}
              onChange={setColorBookId}
              autoSelectDefault
              onBooksLoaded={(books) => setDefaultBookId(books[0]?.id ?? null)}
            />
            <Typography.Text type="secondary" style={{ display: 'block', marginTop: 4, fontSize: 12 }}>
              The supplier&apos;s newest book is the default — pick an older edition only when
              the job was colour-matched against it.
            </Typography.Text>
          </div>
        )}

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

        <div>
          <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
            Customer ref (for the PO title)
          </Typography.Text>
          <Input
            maxLength={60}
            value={customerRef}
            onChange={(e) => setCustomerRef(e.target.value)}
            placeholder="Optional — e.g. DAVID-BAIRD"
            aria-label="Customer ref (for the PO title)"
          />
          <Typography.Text type="secondary" style={{ display: 'block', marginTop: 4, fontSize: 12 }}>
            Appears in the PO title, e.g. DAVID-BAIRD — normalised to UPPERCASE-DASHED.
          </Typography.Text>
        </div>

        <div>
          <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
            Required ship date
          </Typography.Text>
          <DatePicker
            style={{ width: '100%', maxWidth: 240 }}
            format="DD MMM YYYY"
            value={expectedShipDate}
            onChange={setExpectedShipDate}
            placeholder="Optional"
          />
          <Typography.Text type="secondary" style={{ display: 'block', marginTop: 4, fontSize: 12 }}>
            Customer deadline: {deadlineDate ? formatDate(deadlineDate) : 'none set'} — imported to
            the PO automatically
          </Typography.Text>
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
