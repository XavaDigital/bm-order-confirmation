'use client';

/**
 * Shipments — consolidated supplier consignments carrying one or more
 * purchase orders (PO_PLAN). Staff create a shipment against a supplier,
 * pick which of that supplier's POs are in the box, then walk it through the
 * pending → in_transit → delivered lifecycle (with delayed/exception
 * detours) via the per-row status control.
 */
import { useMemo, useState } from 'react';
import {
  App,
  Button,
  Card,
  DatePicker,
  Dropdown,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { DownOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { ShipmentStatusBadge } from '@/components/admin/purchase-orders/ShipmentStatusBadge';
import { getJson, postJson, patchJson } from '@/lib/api-fetch';
import { useAdminResource } from '@/lib/use-admin-resource';
import { formatCurrency, formatDate } from '@/lib/format';
import { SHIPMENT_STATUS, shipmentStatusMeta, type ShipmentStatus } from '@/lib/status';
import { canTransitionShipment, SHIPMENT_STATUSES } from '@/server/shipments/contract';

const { Text } = Typography;

export interface ShipmentRow {
  id: string;
  supplierId: string;
  nickname: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  boxCount: number | null;
  pieceCount: number | null;
  shippingCost: string | null;
  shippingCostCurrency: string;
  etaDate: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  status: ShipmentStatus;
  notes: string | null;
  createdAt: string;
  supplierName: string;
  poCount: number;
  poNumbers: string[];
}

/** Detail shape returned by the create/patch/status/attach endpoints. */
interface ShipmentDetail extends Omit<ShipmentRow, 'supplierName' | 'poCount' | 'poNumbers'> {
  supplier: { id: string; name: string };
  purchaseOrders: { id: string; poNumber: string; status: string; orderId: string; orderNumber: string }[];
}

interface SupplierOption {
  id: string;
  name: string;
}

interface PoListRow {
  id: string;
  poNumber: string;
  status: string;
  orderNumber: string;
  customerName: string;
}

/**
 * "Unshipped" = PO statuses BEFORE in_transit in the PO forward chain. A PO
 * that is in_transit/received/completed is already on (or past) a shipment,
 * and remake/cancelled POs aren't shippable consignment content. The PO list
 * endpoint has no such filter, so it is applied client-side here.
 */
const UNSHIPPED_PO_STATUSES = [
  'draft',
  'approved',
  'sent',
  'confirmed',
  'pre_production',
  'test_print',
  'prod_layout',
  'in_production',
  'quality_control',
];

interface FormValues {
  supplierId: string;
  purchaseOrderIds?: string[];
  /** Per-PO "what's included" notes, keyed by PO id (partial shipments). */
  poContents?: Record<string, string>;
  nickname?: string;
  carrier?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  boxCount?: number | null;
  pieceCount?: number | null;
  shippingCost?: number | null;
  shippingCostCurrency?: string;
  etaDate?: Dayjs | null;
  notes?: string;
}

function toRow(detail: ShipmentDetail): ShipmentRow {
  const { supplier, purchaseOrders, ...rest } = detail;
  return {
    ...rest,
    supplierName: supplier.name,
    poCount: purchaseOrders.length,
    poNumbers: purchaseOrders.map((p) => p.poNumber),
  };
}

export function ShipmentsView() {
  const { message } = App.useApp();

  const { data: shipments, loading, setData: setShipments } = useAdminResource<ShipmentRow[]>(
    '/api/admin/shipments',
    { errorMessage: 'Failed to load shipments' },
  );
  const { data: suppliers } = useAdminResource<SupplierOption[]>('/api/admin/suppliers?active=1', {
    errorMessage: 'Failed to load suppliers',
  });

  const [statusFilter, setStatusFilter] = useState<ShipmentStatus | undefined>();
  const [supplierFilter, setSupplierFilter] = useState<string | undefined>();

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ShipmentRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [poOptions, setPoOptions] = useState<PoListRow[]>([]);
  const [poLoading, setPoLoading] = useState(false);
  const [form] = Form.useForm<FormValues>();

  const visible = useMemo(
    () =>
      (shipments ?? []).filter(
        (row) =>
          (!statusFilter || row.status === statusFilter) &&
          (!supplierFilter || row.supplierId === supplierFilter),
      ),
    [shipments, statusFilter, supplierFilter],
  );

  function replaceRow(updated: ShipmentRow) {
    setShipments((prev) => (prev ?? []).map((s) => (s.id === updated.id ? updated : s)));
  }

  async function loadPoOptions(supplierId: string) {
    setPoLoading(true);
    try {
      const pos = await getJson<PoListRow[]>(
        `/api/admin/purchase-orders?supplierId=${supplierId}`,
        'Failed to load purchase orders',
      );
      setPoOptions(pos.filter((po) => UNSHIPPED_PO_STATUSES.includes(po.status)));
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to load purchase orders');
    } finally {
      setPoLoading(false);
    }
  }

  function openCreate() {
    setEditing(null);
    setPoOptions([]);
    form.resetFields();
    form.setFieldsValue({ shippingCostCurrency: 'USD' });
    setModalOpen(true);
  }

  function openEdit(row: ShipmentRow) {
    setEditing(row);
    form.resetFields();
    form.setFieldsValue({
      supplierId: row.supplierId,
      nickname: row.nickname ?? undefined,
      carrier: row.carrier ?? undefined,
      trackingNumber: row.trackingNumber ?? undefined,
      trackingUrl: row.trackingUrl ?? undefined,
      boxCount: row.boxCount ?? undefined,
      pieceCount: row.pieceCount ?? undefined,
      shippingCost: row.shippingCost !== null ? Number(row.shippingCost) : undefined,
      shippingCostCurrency: row.shippingCostCurrency,
      etaDate: row.etaDate ? dayjs(row.etaDate) : undefined,
      notes: row.notes ?? undefined,
    });
    setModalOpen(true);
  }

  async function save() {
    let values: FormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    const trimmedOrNull = (v?: string) => {
      const t = v?.trim();
      return t ? t : null;
    };

    setSaving(true);
    try {
      if (editing) {
        // PATCH semantics: null clears clearable fields (supplier/POs are not
        // editable here — PO membership changes go through attach/detach).
        const detail = await patchJson<ShipmentDetail>(
          `/api/admin/shipments/${editing.id}`,
          {
            nickname: trimmedOrNull(values.nickname),
            carrier: trimmedOrNull(values.carrier),
            trackingNumber: trimmedOrNull(values.trackingNumber),
            trackingUrl: trimmedOrNull(values.trackingUrl),
            boxCount: values.boxCount ?? null,
            pieceCount: values.pieceCount ?? null,
            shippingCost: values.shippingCost ?? null,
            shippingCostCurrency: values.shippingCostCurrency?.trim() || 'USD',
            etaDate: values.etaDate ? values.etaDate.format('YYYY-MM-DD') : null,
            notes: trimmedOrNull(values.notes),
          },
          'Failed to save shipment',
        );
        replaceRow(toRow(detail));
        message.success('Shipment updated');
      } else {
        // Create omits empty optional fields (the create contract takes
        // optional, not nullable, fields).
        const body: Record<string, unknown> = {
          supplierId: values.supplierId,
          purchaseOrderIds: values.purchaseOrderIds ?? [],
          nickname: trimmedOrNull(values.nickname),
          carrier: trimmedOrNull(values.carrier),
          trackingNumber: trimmedOrNull(values.trackingNumber),
          trackingUrl: trimmedOrNull(values.trackingUrl),
          boxCount: values.boxCount ?? null,
          pieceCount: values.pieceCount ?? null,
          shippingCost: values.shippingCost ?? null,
          shippingCostCurrency: values.shippingCostCurrency?.trim() || 'USD',
          etaDate: values.etaDate ? values.etaDate.format('YYYY-MM-DD') : null,
          notes: trimmedOrNull(values.notes),
        };
        // Per-PO contents notes: only for still-selected POs, only non-empty.
        const poContents = Object.fromEntries(
          Object.entries(values.poContents ?? {}).filter(
            ([poId, note]) =>
              (values.purchaseOrderIds ?? []).includes(poId) && note?.trim(),
          ),
        );
        if (Object.keys(poContents).length > 0) body.poContents = poContents;
        for (const key of Object.keys(body)) {
          if (body[key] === null) delete body[key];
        }
        const detail = await postJson<ShipmentDetail>(
          '/api/admin/shipments',
          body,
          'Failed to create shipment',
        );
        setShipments((prev) => [toRow(detail), ...(prev ?? [])]);
        message.success('Shipment created');
      }
      setModalOpen(false);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to save shipment');
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(row: ShipmentRow, next: ShipmentStatus) {
    try {
      const detail = await postJson<ShipmentDetail>(
        `/api/admin/shipments/${row.id}/status`,
        { status: next },
        'Failed to update shipment status',
      );
      replaceRow(toRow(detail));
      message.success(`Shipment marked ${shipmentStatusMeta(next).label.toLowerCase()}`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to update shipment status');
    }
  }

  const columns = [
    {
      title: 'Shipment',
      key: 'nickname',
      render: (_: unknown, row: ShipmentRow) => (
        <Text strong>{row.nickname ?? `Shipment ${row.id.slice(0, 8)}`}</Text>
      ),
    },
    {
      title: 'Supplier',
      dataIndex: 'supplierName',
      key: 'supplier',
    },
    {
      title: 'Carrier / tracking',
      key: 'carrier',
      render: (_: unknown, row: ShipmentRow) =>
        row.carrier || row.trackingNumber ? (
          <Space direction="vertical" size={0}>
            {row.carrier && <Text>{row.carrier}</Text>}
            {row.trackingNumber &&
              (row.trackingUrl ? (
                <a href={row.trackingUrl} target="_blank" rel="noopener noreferrer">
                  {row.trackingNumber}
                </a>
              ) : (
                <Text type="secondary">{row.trackingNumber}</Text>
              ))}
          </Space>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: 'POs',
      key: 'pos',
      render: (_: unknown, row: ShipmentRow) => (
        <Space direction="vertical" size={0}>
          <Text>{row.poCount}</Text>
          <Space wrap size={4}>
            {row.poNumbers.map((po) => (
              <Tag key={po}>{po}</Tag>
            ))}
          </Space>
        </Space>
      ),
    },
    {
      title: 'Boxes / pieces',
      key: 'counts',
      render: (_: unknown, row: ShipmentRow) =>
        row.boxCount !== null || row.pieceCount !== null ? (
          <Text>
            {row.boxCount ?? '—'} / {row.pieceCount ?? '—'}
          </Text>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: 'Cost',
      key: 'cost',
      render: (_: unknown, row: ShipmentRow) =>
        row.shippingCost !== null ? (
          <Text>
            {formatCurrency(row.shippingCost)} {row.shippingCostCurrency}
          </Text>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: 'ETA',
      key: 'eta',
      render: (_: unknown, row: ShipmentRow) =>
        row.etaDate ? formatDate(row.etaDate) : <Text type="secondary">—</Text>,
    },
    {
      title: 'Status',
      key: 'status',
      render: (_: unknown, row: ShipmentRow) => <ShipmentStatusBadge status={row.status} />,
    },
    {
      title: '',
      key: 'actions',
      width: 220,
      render: (_: unknown, row: ShipmentRow) => {
        // The per-row status menu offers exactly the machine's legal moves.
        const nextStatuses = SHIPMENT_STATUSES.filter((s) => canTransitionShipment(row.status, s));
        return (
          <Space>
            {nextStatuses.length > 0 && (
              <Dropdown
                trigger={['click']}
                menu={{
                  items: nextStatuses.map((next) => ({
                    key: next,
                    label:
                      next === 'cancelled' ? (
                        <Popconfirm
                          title="Cancel this shipment?"
                          description="The attached POs stay untouched."
                          okText="Cancel shipment"
                          cancelText="Keep"
                          onConfirm={() => changeStatus(row, next)}
                        >
                          <span>{shipmentStatusMeta(next).label}</span>
                        </Popconfirm>
                      ) : (
                        shipmentStatusMeta(next).label
                      ),
                    onClick: next === 'cancelled' ? undefined : () => changeStatus(row, next),
                  })),
                }}
              >
                <Button size="small">
                  Set status <DownOutlined />
                </Button>
              </Dropdown>
            )}
            <Button
              type="link"
              size="small"
              aria-label="Edit"
              icon={<EditOutlined />}
              onClick={() => openEdit(row)}
            />
          </Space>
        );
      },
    },
  ];

  return (
    <>
      <AdminPageHeader
        title="Shipments"
        subtitle="Supplier consignments carrying one or more purchase orders"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            New Shipment
          </Button>
        }
      />

      <Card>
        <Space style={{ marginBottom: 16 }} wrap>
          <Select
            allowClear
            placeholder="Filter by status"
            style={{ width: 180 }}
            value={statusFilter}
            onChange={(v) => setStatusFilter(v)}
            options={Object.entries(SHIPMENT_STATUS).map(([value, meta]) => ({
              value,
              label: meta.label,
            }))}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="Filter by supplier"
            style={{ width: 220 }}
            value={supplierFilter}
            onChange={(v) => setSupplierFilter(v)}
            options={(suppliers ?? []).map((s) => ({ value: s.id, label: s.name }))}
          />
        </Space>

        <Table
          columns={columns}
          dataSource={visible}
          rowKey="id"
          loading={loading}
          pagination={false}
          locale={{ emptyText: 'No shipments yet — create one to track a supplier consignment.' }}
        />
      </Card>

      <Modal
        title={editing ? `Edit ${editing.nickname ?? 'shipment'}` : 'New Shipment'}
        open={modalOpen}
        onOk={save}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        width={720}
        okText={editing ? 'Save' : 'Create'}
      >
        <Form form={form} layout="vertical">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            <Form.Item
              label="Supplier"
              name="supplierId"
              rules={[{ required: true, message: 'Pick a supplier' }]}
            >
              <Select
                placeholder="Pick a supplier"
                disabled={!!editing}
                options={(suppliers ?? []).map((s) => ({ value: s.id, label: s.name }))}
                onChange={(supplierId: string) => {
                  form.setFieldValue('purchaseOrderIds', []);
                  loadPoOptions(supplierId);
                }}
              />
            </Form.Item>
            <Form.Item label="Nickname" name="nickname">
              <Input placeholder="e.g. July air freight" maxLength={300} />
            </Form.Item>
          </div>

          {!editing && (
            <Form.Item
              label="Purchase orders"
              name="purchaseOrderIds"
              tooltip="Unshipped POs of the selected supplier (not yet in transit)"
              rules={[{ required: true, message: 'Pick at least one purchase order' }]}
            >
              <Select
                mode="multiple"
                placeholder="Pick the POs in this shipment"
                loading={poLoading}
                optionFilterProp="label"
                options={poOptions.map((po) => ({
                  value: po.id,
                  label: `${po.poNumber} — ${po.customerName}`,
                }))}
              />
            </Form.Item>
          )}

          {/* Partial shipments (David, 2026-08-05): a PO can split across
              consignments weeks apart, so each attached PO takes an optional
              "what's included" note. Blank = the whole PO. */}
          {!editing && (
            <Form.Item
              noStyle
              shouldUpdate={(prev, cur) => prev.purchaseOrderIds !== cur.purchaseOrderIds}
            >
              {({ getFieldValue }) => {
                const ids: string[] = getFieldValue('purchaseOrderIds') ?? [];
                if (ids.length === 0) return null;
                return (
                  <>
                    {ids.map((poId) => {
                      const po = poOptions.find((p) => p.id === poId);
                      return (
                        <Form.Item
                          key={poId}
                          label={`What's included from ${po?.poNumber ?? 'this PO'}`}
                          name={['poContents', poId]}
                          tooltip="Optional — for a partial shipment, note which part of the PO is in this consignment"
                        >
                          <Input
                            placeholder="Leave blank if the whole PO is in this shipment"
                            maxLength={500}
                          />
                        </Form.Item>
                      );
                    })}
                  </>
                );
              }}
            </Form.Item>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 16px' }}>
            <Form.Item label="Carrier" name="carrier">
              <Input placeholder="e.g. DHL" maxLength={300} />
            </Form.Item>
            <Form.Item label="Tracking number" name="trackingNumber">
              <Input placeholder="e.g. DHL1234567890" maxLength={300} />
            </Form.Item>
            <Form.Item
              label="Tracking URL"
              name="trackingUrl"
              rules={[{ type: 'url', message: 'Enter a valid URL' }]}
            >
              <Input placeholder="https://…" maxLength={300} />
            </Form.Item>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 100px', gap: '0 16px' }}>
            <Form.Item label="Boxes" name="boxCount">
              <InputNumber min={0} precision={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="Pieces" name="pieceCount">
              <InputNumber min={0} precision={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="Shipping cost" name="shippingCost">
              <InputNumber min={0} step={0.01} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              label="Currency"
              name="shippingCostCurrency"
              rules={[{ pattern: /^[a-zA-Z]{3}$/, message: '3-letter code' }]}
            >
              <Input maxLength={3} style={{ textTransform: 'uppercase' }} />
            </Form.Item>
          </div>

          <Form.Item label="ETA" name="etaDate">
            <DatePicker style={{ width: 200 }} />
          </Form.Item>

          <Form.Item label="Notes" name="notes">
            <Input.TextArea rows={3} maxLength={2000} placeholder="Anything the team should know about this shipment" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
