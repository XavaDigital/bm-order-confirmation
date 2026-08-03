'use client';

/**
 * Garment Types preset catalog — admin manages garment types (fabric options,
 * configurable order options, size lists, linked reference charts) so order
 * building is picking from presets instead of retyping strings. Modeled on
 * Sales Hub's Products page. Sales role gets a read-only view.
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
  Select,
  Space,
  Tag,
  Typography,
  Switch,
  App,
} from 'antd';
import { PlusOutlined, EditOutlined } from '@ant-design/icons';
import type { GarmentTypeOption, GarmentTypeFabricField } from '@/db/schema';
import { SectionTitle } from '@/components/admin/SectionTitle';
import { OrderOptionsManager } from '@/components/admin/garment-types/OrderOptionsManager';
import { FabricFieldsManager } from '@/components/admin/garment-types/FabricFieldsManager';
import { postJson, patchJson } from '@/lib/api-fetch';
import { useAdminResource } from '@/lib/use-admin-resource';

const { Text } = Typography;

export interface GarmentTypeRow {
  id: string;
  name: string;
  category: string | null;
  fabricFields: GarmentTypeFabricField[];
  orderOptions: GarmentTypeOption[];
  sizeChartIds: string[];
  isActive: boolean;
  sortOrder: number;
}

interface SizeChartOption {
  id: string;
  name: string;
}

interface FormValues {
  name: string;
  category?: string;
  sizeChartIds: string[];
  isActive: boolean;
}

interface Props {
  role: StaffRole;
}

export function GarmentTypesView({ role }: Props) {
  const { message } = App.useApp();
  // Convention: admins mutate, sales get a read-only view.
  const canMutate = role === 'admin';

  const { data: types, loading: typesLoading, setData: setTypes } = useAdminResource<
    GarmentTypeRow[]
  >('/api/admin/garment-types', { errorMessage: 'Failed to load garment types' });
  const { data: charts, loading: chartsLoading } = useAdminResource<SizeChartOption[]>(
    '/api/admin/size-charts',
    { errorMessage: 'Failed to load size charts' },
  );
  const loading = typesLoading || chartsLoading;
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<GarmentTypeRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<FormValues>();
  // Managed outside the Form (custom components with their own modals)
  const [orderOptions, setOrderOptions] = useState<GarmentTypeOption[]>([]);
  const [fabricFields, setFabricFields] = useState<GarmentTypeFabricField[]>([]);

  function openAdd() {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ sizeChartIds: [], isActive: true });
    setOrderOptions([]);
    setFabricFields([]);
    setModalOpen(true);
  }

  function openEdit(row: GarmentTypeRow) {
    setEditing(row);
    form.setFieldsValue({
      name: row.name,
      category: row.category ?? undefined,
      sizeChartIds: row.sizeChartIds,
      isActive: row.isActive,
    });
    setOrderOptions(row.orderOptions);
    setFabricFields(row.fabricFields);
    setModalOpen(true);
  }

  async function save() {
    let values: FormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    const incompleteField = fabricFields.some((f) => !f.label.trim() || f.options.length === 0);
    if (incompleteField) {
      message.error('Every fabric field needs a label and at least one fabric');
      return;
    }

    const body = {
      name: values.name,
      category: values.category || null,
      fabricFields,
      orderOptions,
      sizeChartIds: values.sizeChartIds,
      isActive: values.isActive,
    };

    setSaving(true);
    try {
      if (editing) {
        const updated = await patchJson<GarmentTypeRow>(
          `/api/admin/garment-types/${editing.id}`,
          body,
          'Failed to save garment type',
        );
        setTypes((prev) => (prev ?? []).map((t) => (t.id === editing.id ? updated : t)));
        message.success('Garment type updated');
      } else {
        const created = await postJson<GarmentTypeRow>(
          '/api/admin/garment-types',
          body,
          'Failed to create garment type',
        );
        setTypes((prev) => [...(prev ?? []), created]);
        message.success('Garment type created');
      }
      setModalOpen(false);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to save garment type');
    } finally {
      setSaving(false);
    }
  }

  const columns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, row: GarmentTypeRow) => (
        <Space>
          <Text strong>{name}</Text>
          {!row.isActive && <Tag>Inactive</Tag>}
        </Space>
      ),
    },
    {
      title: 'Category',
      dataIndex: 'category',
      key: 'category',
      render: (c: string | null) => c ?? <Text type="secondary">—</Text>,
    },
    {
      title: 'Fabric fields',
      key: 'fabrics',
      render: (_: unknown, row: GarmentTypeRow) => {
        const fields = row.fabricFields;
        return fields.length > 0 ? (
          <Space wrap>
            {fields.map((f) => (
              <Tag key={f.label}>
                {f.label} ({f.options.length})
              </Tag>
            ))}
          </Space>
        ) : (
          <Text type="secondary">—</Text>
        );
      },
    },
    {
      title: 'Options',
      key: 'options',
      render: (_: unknown, row: GarmentTypeRow) =>
        row.orderOptions.length > 0 ? `${row.orderOptions.length}` : <Text type="secondary">—</Text>,
    },
    {
      title: 'Charts',
      key: 'charts',
      render: (_: unknown, row: GarmentTypeRow) =>
        row.sizeChartIds.length > 0 ? `${row.sizeChartIds.length}` : <Text type="secondary">—</Text>,
    },
    ...(canMutate
      ? [
          {
            title: '',
            key: 'actions',
            width: 60,
            render: (_: unknown, row: GarmentTypeRow) => (
              <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(row)} />
            ),
          },
        ]
      : []),
  ];

  return (
    <Card
      title="Garment Types"
      extra={
        canMutate && (
          <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>
            New Type
          </Button>
        )
      }
    >
      <Table
        columns={columns}
        dataSource={types ?? []}
        rowKey="id"
        loading={loading}
        pagination={false}
        locale={{ emptyText: 'No garment types yet — create presets so orders can be built from pick-lists.' }}
      />

      <Modal
        title={editing ? `Edit ${editing.name}` : 'New Garment Type'}
        open={modalOpen}
        onOk={save}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        width={760}
        okText={editing ? 'Save' : 'Create'}
      >
        <Form form={form} layout="vertical" disabled={!canMutate}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 120px', gap: '0 16px' }}>
            <Form.Item
              label="Name"
              name="name"
              rules={[{ required: true, message: 'Enter a name' }]}
            >
              <Input placeholder="e.g. Pullover Hoodie" />
            </Form.Item>
            <Form.Item label="Category" name="category">
              <Input placeholder="e.g. Hoodies" />
            </Form.Item>
            <Form.Item label="Active" name="isActive" valuePropName="checked">
              <Switch />
            </Form.Item>
          </div>

          <Form.Item
            label="Reference size charts"
            name="sizeChartIds"
            help="Auto-attached to garments created with this type — their size lists become the selectable sizes"
          >
            <Select
              mode="multiple"
              placeholder="Select size charts"
              optionFilterProp="label"
              options={(charts ?? []).map((c) => ({ value: c.id, label: c.name }))}
            />
          </Form.Item>

          <SectionTitle style={{ marginTop: 8 }}>Fabric fields</SectionTitle>
          <FabricFieldsManager value={fabricFields} onChange={setFabricFields} disabled={!canMutate} />

          <SectionTitle style={{ marginTop: 16 }}>Order options</SectionTitle>
          <OrderOptionsManager value={orderOptions} onChange={setOrderOptions} disabled={!canMutate} />
        </Form>
      </Modal>
    </Card>
  );
}
