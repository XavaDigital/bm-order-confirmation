'use client';

/**
 * Design + font files on an order: named links (Drive URLs) that the factory and
 * the next reprint need. Order-wide by default, optionally tagged to a garment.
 * Assets marked "Send to supplier" are captured into each PO revision snapshot.
 */
import { useState } from 'react';
import {
  App,
  Button,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { DeleteOutlined, EditOutlined, LinkOutlined, PlusOutlined } from '@ant-design/icons';
import type { ColumnType } from 'antd/es/table';
import { deleteJson, patchJson, postJson } from '@/lib/api-fetch';
import { useAdminResource } from '@/lib/use-admin-resource';
import type { OrderAssetKind } from '@/db/schema';

export interface OrderAsset {
  id: string;
  kind: OrderAssetKind;
  name: string;
  url: string;
  notes: string | null;
  garmentId: string | null;
  includeOnPo: boolean;
  sortOrder: number;
  garment?: { id: string; name: string } | null;
}

interface Props {
  orderId: string;
  garments: Array<{ id: string; name: string }>;
}

const KIND_LABEL: Record<OrderAssetKind, string> = {
  design: 'Design',
  font: 'Font',
  other: 'Other',
};

const KIND_COLOR: Record<OrderAssetKind, string> = {
  design: 'geekblue',
  font: 'purple',
  other: 'default',
};

interface FormValues {
  kind: OrderAssetKind;
  name: string;
  url: string;
  notes?: string;
  garmentId?: string | null;
  includeOnPo: boolean;
}

export function OrderAssetsPanel({ orderId, garments }: Props) {
  const { message } = App.useApp();
  const { data, loading, error, reload } = useAdminResource<OrderAsset[]>(
    `/api/admin/orders/${orderId}/assets`,
    { errorMessage: 'Failed to load design files', toast: false },
  );
  const assets = data ?? [];

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<OrderAsset | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<FormValues>();

  function openAdd() {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ kind: 'design', includeOnPo: false, garmentId: null });
    setModalOpen(true);
  }

  function openEdit(asset: OrderAsset) {
    setEditing(asset);
    form.setFieldsValue({
      kind: asset.kind,
      name: asset.name,
      url: asset.url,
      notes: asset.notes ?? undefined,
      garmentId: asset.garmentId,
      includeOnPo: asset.includeOnPo,
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

    const body = {
      kind: values.kind,
      name: values.name,
      url: values.url,
      notes: values.notes?.trim() ? values.notes : null,
      garmentId: values.garmentId ?? null,
      includeOnPo: values.includeOnPo,
    };

    setSaving(true);
    try {
      if (editing) {
        await patchJson(
          `/api/admin/orders/${orderId}/assets/${editing.id}`,
          body,
          'Failed to save the file',
        );
        message.success('File updated');
      } else {
        await postJson(`/api/admin/orders/${orderId}/assets`, body, 'Failed to add the file');
        message.success('File added');
      }
      setModalOpen(false);
      reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to save the file');
    } finally {
      setSaving(false);
    }
  }

  async function remove(asset: OrderAsset) {
    try {
      await deleteJson(
        `/api/admin/orders/${orderId}/assets/${asset.id}`,
        undefined,
        'Failed to remove the file',
      );
      message.success('File removed');
      reload();
    } catch {
      message.error('Failed to remove the file');
    }
  }

  /** Flip the supplier flag inline — it's the field staff change most. */
  async function toggleIncludeOnPo(asset: OrderAsset, includeOnPo: boolean) {
    try {
      await patchJson(
        `/api/admin/orders/${orderId}/assets/${asset.id}`,
        { includeOnPo },
        'Failed to update the file',
      );
      reload();
    } catch {
      message.error('Failed to update the file');
    }
  }

  const columns: ColumnType<OrderAsset>[] = [
    {
      title: 'Type',
      dataIndex: 'kind',
      width: 90,
      render: (kind: OrderAssetKind) => <Tag color={KIND_COLOR[kind]}>{KIND_LABEL[kind]}</Tag>,
    },
    {
      title: 'Name',
      dataIndex: 'name',
      render: (name: string, asset: OrderAsset) => (
        <Space direction="vertical" size={0}>
          <a href={asset.url} target="_blank" rel="noopener noreferrer">
            <Space size={4}>
              <LinkOutlined />
              {name}
            </Space>
          </a>
          {asset.notes && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {asset.notes}
            </Typography.Text>
          )}
        </Space>
      ),
    },
    {
      title: 'Applies to',
      dataIndex: 'garmentId',
      width: 160,
      render: (_: unknown, asset: OrderAsset) =>
        asset.garment ? (
          asset.garment.name
        ) : (
          <Typography.Text type="secondary">Whole order</Typography.Text>
        ),
    },
    {
      title: (
        <Tooltip title="Included in the PDF and spreadsheet sent to the supplier">
          <span>To supplier</span>
        </Tooltip>
      ),
      dataIndex: 'includeOnPo',
      width: 110,
      render: (includeOnPo: boolean, asset: OrderAsset) => (
        <Switch
          size="small"
          checked={includeOnPo}
          onChange={(checked) => void toggleIncludeOnPo(asset, checked)}
          aria-label={`Send ${asset.name} to supplier`}
        />
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 80,
      render: (_: unknown, asset: OrderAsset) => (
        <Space size={0}>
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            aria-label={`Edit ${asset.name}`}
            onClick={() => openEdit(asset)}
          />
          <Popconfirm
            title="Remove this file?"
            description="The link is removed from this order. The file itself is untouched."
            onConfirm={() => void remove(asset)}
            okText="Remove"
            okType="danger"
          >
            <Button
              type="text"
              size="small"
              danger
              icon={<DeleteOutlined />}
              aria-label={`Remove ${asset.name}`}
            />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Typography.Title level={5} style={{ margin: 0, flex: 1 }}>
          Design &amp; font files
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>
          Add file
        </Button>
      </div>

      {error ? (
        <Typography.Text type="danger">{error}</Typography.Text>
      ) : assets.length === 0 && !loading ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No design or font files linked yet"
        />
      ) : (
        <Table
          dataSource={assets}
          columns={columns}
          rowKey="id"
          size="small"
          loading={loading}
          pagination={false}
        />
      )}

      <Modal
        open={modalOpen}
        title={editing ? `Edit ${editing.name}` : 'Add a design or font file'}
        onOk={save}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        okText={editing ? 'Save' : 'Add file'}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item label="Type" name="kind" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'design', label: 'Design file' },
                { value: 'font', label: 'Font file' },
                { value: 'other', label: 'Other' },
              ]}
            />
          </Form.Item>
          <Form.Item
            label="Name"
            name="name"
            rules={[{ required: true, message: 'Give the file a name' }]}
          >
            <Input placeholder="e.g. Front print (AI), Club font" maxLength={200} />
          </Form.Item>
          <Form.Item
            label="Link"
            name="url"
            rules={[
              { required: true, message: 'Add a link' },
              { type: 'url', message: 'Enter a full URL, e.g. https://drive.google.com/…' },
            ]}
          >
            <Input placeholder="https://drive.google.com/…" />
          </Form.Item>
          <Form.Item
            label="Applies to"
            name="garmentId"
            extra="Leave as the whole order unless this file is only for one garment."
          >
            <Select
              allowClear
              placeholder="Whole order"
              options={garments.map((g) => ({ value: g.id, label: g.name }))}
            />
          </Form.Item>
          <Form.Item label="Notes" name="notes">
            <Input.TextArea rows={2} maxLength={1000} placeholder="Optional" />
          </Form.Item>
          <Form.Item
            label="Send to supplier"
            name="includeOnPo"
            valuePropName="checked"
            extra="Included in purchase-order documents. Off for internal working files."
          >
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
