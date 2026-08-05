'use client';

/**
 * Suppliers directory — admin manages the factory partners referenced by
 * purchase orders (PO_PLAN): contact details, specialties, MOQ/lead-time and
 * the short supplier code used in PO numbers. Deactivate-never-delete, like
 * garment types. Sales role gets a read-only view.
 */
import type { StaffRole } from '@/lib/roles';
import { useState } from 'react';
import {
  Card,
  Table,
  Button,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
  App,
} from 'antd';
import { PlusOutlined, EditOutlined } from '@ant-design/icons';
import { postJson, patchJson } from '@/lib/api-fetch';
import { useAdminResource } from '@/lib/use-admin-resource';

const { Text } = Typography;

export interface SupplierRow {
  id: string;
  name: string;
  supplierCode: string | null;
  /** Readable portal password — set means the /supplier/{CODE} portal is open. */
  portalPassword: string | null;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  address: Record<string, unknown> | null;
  specialties: string[];
  minimumOrderQuantity: number | null;
  leadTimeWeeks: number | null;
  notes: string | null;
  isActive: boolean;
}

interface FormValues {
  name: string;
  supplierCode?: string;
  portalPassword?: string;
  contactPerson?: string;
  email?: string;
  phone?: string;
  website?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
  specialties: string[];
  minimumOrderQuantity?: number | null;
  leadTimeWeeks?: number | null;
  notes?: string;
  isActive: boolean;
}

interface Props {
  role: StaffRole;
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

export function SuppliersView({ role }: Props) {
  const { message } = App.useApp();
  // Convention: admins mutate, sales get a read-only view.
  const canMutate = role === 'admin';

  const { data: suppliers, loading, setData: setSuppliers } = useAdminResource<SupplierRow[]>(
    '/api/admin/suppliers',
    { errorMessage: 'Failed to load suppliers' },
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SupplierRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<FormValues>();

  function openAdd() {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ specialties: [], isActive: true });
    setModalOpen(true);
  }

  function openEdit(row: SupplierRow) {
    setEditing(row);
    form.resetFields();
    form.setFieldsValue({
      name: row.name,
      supplierCode: row.supplierCode ?? undefined,
      portalPassword: row.portalPassword ?? undefined,
      contactPerson: row.contactPerson ?? undefined,
      email: row.email ?? undefined,
      phone: row.phone ?? undefined,
      website: row.website ?? undefined,
      addressLine1: str(row.address?.line1),
      addressLine2: str(row.address?.line2),
      city: str(row.address?.city),
      region: str(row.address?.region),
      postalCode: str(row.address?.postalCode),
      country: str(row.address?.country),
      specialties: row.specialties,
      minimumOrderQuantity: row.minimumOrderQuantity ?? undefined,
      leadTimeWeeks: row.leadTimeWeeks ?? undefined,
      notes: row.notes ?? undefined,
      isActive: row.isActive,
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

    const addressEntries: [string, string][] = [];
    for (const [key, value] of [
      ['line1', values.addressLine1],
      ['line2', values.addressLine2],
      ['city', values.city],
      ['region', values.region],
      ['postalCode', values.postalCode],
      ['country', values.country],
    ] as [string, string | undefined][]) {
      const trimmed = value?.trim();
      if (trimmed) addressEntries.push([key, trimmed]);
    }
    const address = addressEntries.length > 0 ? Object.fromEntries(addressEntries) : null;

    // Update semantics: null clears a field. Create omits nulls (the create
    // contract takes optional, not nullable, fields).
    const body: Record<string, unknown> = {
      name: values.name,
      supplierCode: trimmedOrNull(values.supplierCode),
      // null clears the password, which closes the portal and signs the
      // supplier out (the PATCH contract takes portalPassword nullable).
      portalPassword: trimmedOrNull(values.portalPassword),
      contactPerson: trimmedOrNull(values.contactPerson),
      email: trimmedOrNull(values.email),
      phone: trimmedOrNull(values.phone),
      website: trimmedOrNull(values.website),
      address,
      specialties: values.specialties ?? [],
      minimumOrderQuantity: values.minimumOrderQuantity ?? null,
      leadTimeWeeks: values.leadTimeWeeks ?? null,
      notes: trimmedOrNull(values.notes),
      isActive: values.isActive,
    };
    if (!editing) {
      for (const key of Object.keys(body)) {
        if (body[key] === null) delete body[key];
      }
    }

    setSaving(true);
    try {
      if (editing) {
        const updated = await patchJson<SupplierRow>(
          `/api/admin/suppliers/${editing.id}`,
          body,
          'Failed to save supplier',
        );
        setSuppliers((prev) => (prev ?? []).map((s) => (s.id === editing.id ? updated : s)));
        message.success('Supplier updated');
      } else {
        const created = await postJson<SupplierRow>(
          '/api/admin/suppliers',
          body,
          'Failed to create supplier',
        );
        setSuppliers((prev) => [...(prev ?? []), created]);
        message.success('Supplier created');
      }
      setModalOpen(false);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to save supplier');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(row: SupplierRow, next: boolean) {
    try {
      const updated = await patchJson<SupplierRow>(
        `/api/admin/suppliers/${row.id}`,
        { isActive: next },
        'Failed to update supplier',
      );
      setSuppliers((prev) => (prev ?? []).map((s) => (s.id === row.id ? updated : s)));
      message.success(next ? 'Supplier reactivated' : 'Supplier deactivated');
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to update supplier');
    }
  }

  const columns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, row: SupplierRow) => (
        <Space>
          <Text strong>{name}</Text>
          {!row.isActive && <Tag>Inactive</Tag>}
        </Space>
      ),
    },
    {
      title: 'Code',
      dataIndex: 'supplierCode',
      key: 'supplierCode',
      render: (code: string | null) => (code ? <Tag>{code}</Tag> : <Text type="secondary">—</Text>),
    },
    {
      title: 'Contact',
      key: 'contact',
      render: (_: unknown, row: SupplierRow) =>
        row.contactPerson || row.email ? (
          <Space direction="vertical" size={0}>
            {row.contactPerson && <Text>{row.contactPerson}</Text>}
            {row.email && <Text type="secondary">{row.email}</Text>}
          </Space>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: 'Specialties',
      key: 'specialties',
      render: (_: unknown, row: SupplierRow) =>
        row.specialties.length > 0 ? (
          <Space wrap>
            {row.specialties.map((s) => (
              <Tag key={s}>{s}</Tag>
            ))}
          </Space>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: 'Portal',
      key: 'portal',
      width: 90,
      // The supplier portal needs BOTH a code (it's the URL) and a password.
      render: (_: unknown, row: SupplierRow) =>
        row.portalPassword && row.supplierCode ? (
          <Tag color="green">Enabled</Tag>
        ) : (
          <Text type="secondary">Off</Text>
        ),
    },
    {
      title: 'MOQ',
      dataIndex: 'minimumOrderQuantity',
      key: 'moq',
      render: (moq: number | null) => moq ?? <Text type="secondary">—</Text>,
    },
    {
      title: 'Lead time (weeks)',
      dataIndex: 'leadTimeWeeks',
      key: 'leadTime',
      render: (weeks: number | null) => weeks ?? <Text type="secondary">—</Text>,
    },
    {
      title: 'Active',
      key: 'active',
      width: 80,
      render: (_: unknown, row: SupplierRow) => (
        <Switch
          checked={row.isActive}
          disabled={!canMutate}
          onChange={(next) => toggleActive(row, next)}
        />
      ),
    },
    ...(canMutate
      ? [
          {
            title: '',
            key: 'actions',
            width: 60,
            render: (_: unknown, row: SupplierRow) => (
              <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(row)} />
            ),
          },
        ]
      : []),
  ];

  return (
    <Card
      title="Suppliers"
      extra={
        canMutate && (
          <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>
            New Supplier
          </Button>
        )
      }
    >
      <Table
        columns={columns}
        dataSource={suppliers ?? []}
        rowKey="id"
        loading={loading}
        pagination={false}
        locale={{ emptyText: 'No suppliers yet — add your factory partners to build purchase orders against.' }}
      />

      <Modal
        title={editing ? `Edit ${editing.name}` : 'New Supplier'}
        open={modalOpen}
        onOk={save}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        width={720}
        okText={editing ? 'Save' : 'Create'}
      >
        <Form form={form} layout="vertical" disabled={!canMutate}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 120px 100px', gap: '0 16px' }}>
            <Form.Item
              label="Name"
              name="name"
              rules={[{ required: true, message: 'Enter a name' }]}
            >
              <Input placeholder="e.g. Dongguan Apparel Co." />
            </Form.Item>
            <Form.Item
              label="Code"
              name="supplierCode"
              tooltip="Short code used in PO numbers — auto-derived from the name when blank"
              rules={[
                {
                  pattern: /^[a-zA-Z0-9]{1,3}$/,
                  message: '1-3 letters or digits',
                },
              ]}
            >
              <Input placeholder="e.g. DG" maxLength={3} style={{ textTransform: 'uppercase' }} />
            </Form.Item>
            <Form.Item label="Active" name="isActive" valuePropName="checked">
              <Switch />
            </Form.Item>
          </div>

          <Form.Item
            label="Portal password"
            name="portalPassword"
            help="Sets the /supplier/{CODE} portal password; clearing it closes the portal and signs the supplier out."
            rules={[{ min: 6, max: 64, message: '6-64 characters' }]}
          >
            <Input placeholder="Leave blank to keep the portal closed" maxLength={64} />
          </Form.Item>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            <Form.Item label="Contact person" name="contactPerson">
              <Input placeholder="e.g. Li Wei" />
            </Form.Item>
            <Form.Item
              label="Email"
              name="email"
              rules={[{ type: 'email', message: 'Enter a valid email' }]}
            >
              <Input placeholder="e.g. sales@supplier.com" />
            </Form.Item>
            <Form.Item label="Phone" name="phone">
              <Input placeholder="e.g. +86 138 0000 0000" />
            </Form.Item>
            <Form.Item label="Website" name="website">
              <Input placeholder="e.g. https://supplier.com" />
            </Form.Item>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            <Form.Item label="Address line 1" name="addressLine1">
              <Input />
            </Form.Item>
            <Form.Item label="Address line 2" name="addressLine2">
              <Input />
            </Form.Item>
            <Form.Item label="City" name="city">
              <Input />
            </Form.Item>
            <Form.Item label="Region / state" name="region">
              <Input />
            </Form.Item>
            <Form.Item label="Postal code" name="postalCode">
              <Input />
            </Form.Item>
            <Form.Item label="Country" name="country">
              <Input />
            </Form.Item>
          </div>

          <Form.Item
            label="Specialties"
            name="specialties"
            help="Free-form tags, e.g. hoodies, sublimation, embroidery"
          >
            <Select mode="tags" placeholder="Type and press enter" open={false} suffixIcon={null} />
          </Form.Item>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            <Form.Item label="Minimum order quantity" name="minimumOrderQuantity">
              <InputNumber min={0} precision={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="Lead time (weeks)" name="leadTimeWeeks">
              <InputNumber min={0} precision={0} style={{ width: '100%' }} />
            </Form.Item>
          </div>

          <Form.Item label="Notes" name="notes">
            <Input.TextArea rows={3} placeholder="Anything the team should know about this supplier" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
