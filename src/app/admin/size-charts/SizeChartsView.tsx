'use client';

import type { StaffRole } from '@/lib/roles';
import { useState } from 'react';
import {
  Table,
  Button,
  Form,
  Input,
  Select,
  Upload,
  Space,
  Typography,
  Popconfirm,
  App,
  Card,
  Modal,
  Tag,
  Tooltip,
} from 'antd';
import {
  UploadOutlined,
  DeleteOutlined,
  EditOutlined,
  FilePdfOutlined,
  FileImageOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import type { ColumnType } from 'antd/es/table';
import { formatDate } from '@/lib/format';
import { deleteJson, patchJson, postForm } from '@/lib/api-fetch';
import { useAdminResource } from '@/lib/use-admin-resource';
import { SEMANTIC } from '@/lib/semantic-colors';
import type { SizeChartKind, SizeChartSize } from '@/db/schema';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { SizeListManager } from '@/components/admin/size-charts/SizeListManager';

interface SizeChart {
  id: string;
  name: string;
  description: string | null;
  storageKey: string | null;
  kind: SizeChartKind;
  sizes: SizeChartSize[];
  createdAt: string;
  url: string | null;
}

/** Kind presentation — shared by the table tag and the modal selects. */
const KIND_META: Record<SizeChartKind, { label: string; color: string }> = {
  customer: { label: 'Customer', color: 'cyan' },
  production: { label: 'Production', color: 'purple' },
};

const KIND_OPTIONS = (Object.keys(KIND_META) as SizeChartKind[]).map((k) => ({
  value: k,
  label: KIND_META[k].label,
}));

function kindTag(kind: SizeChartKind) {
  const meta = KIND_META[kind] ?? KIND_META.customer;
  return <Tag color={meta.color}>{meta.label}</Tag>;
}

/** Single source of truth for the PDF-vs-image file-type checks in this view. */
function isPdf(storageKey: string | null | undefined): boolean {
  return Boolean(storageKey?.endsWith('.pdf'));
}

function fileIcon(storageKey: string | null) {
  if (!storageKey) return null;
  return isPdf(storageKey) ? (
    <FilePdfOutlined style={{ color: SEMANTIC.error, marginRight: 6 }} />
  ) : (
    <FileImageOutlined style={{ color: SEMANTIC.info, marginRight: 6 }} />
  );
}

function fileTypeTag(storageKey: string | null) {
  if (!storageKey) return null;
  return isPdf(storageKey) ? <Tag color="red">PDF</Tag> : <Tag color="blue">Image</Tag>;
}

interface SizeChartsViewProps {
  role: StaffRole;
}

export function SizeChartsView({ role }: SizeChartsViewProps) {
  // Convention: admins mutate, sales get a read-only view.
  const canMutate = role === 'admin';
  const { message } = App.useApp();
  const { data: charts, loading, setData: setCharts } = useAdminResource<SizeChart[]>(
    '/api/admin/size-charts',
    { errorMessage: 'Failed to load size charts' },
  );
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editingChart, setEditingChart] = useState<SizeChart | null>(null);
  const [viewingChart, setViewingChart] = useState<SizeChart | null>(null);
  const [form] = Form.useForm();
  const [uploading, setUploading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Managed outside the antd Form (custom component) — GarmentTypesView pattern
  const [sizes, setSizes] = useState<SizeChartSize[]>([]);

  async function handleUpload() {
    let values: { name: string; description?: string; kind: SizeChartKind; file?: { file: File } };
    try { values = await form.validateFields(); } catch { return; }

    const file = values.file?.file;
    if (!file) { message.error('Please select a file'); return; }

    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('name', values.name);
      if (values.description) fd.append('description', values.description);
      fd.append('kind', values.kind ?? 'customer');
      fd.append('sizes', JSON.stringify(sizes));
      fd.append('file', file);

      const chart = await postForm<SizeChart>('/api/admin/size-charts', fd, 'Upload failed');
      setCharts((prev) => [chart, ...(prev ?? [])]);
      message.success(`"${chart.name}" uploaded`);
      setUploadOpen(false);
      form.resetFields();
    } catch (err: unknown) {
      message.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function handleEdit() {
    if (!editingChart) return;
    let values: { name: string; description?: string; kind: SizeChartKind };
    try { values = await form.validateFields(); } catch { return; }

    setEditSaving(true);
    try {
      const updated = await patchJson<SizeChart>(
        `/api/admin/size-charts/${editingChart.id}`,
        { name: values.name, description: values.description ?? null, kind: values.kind, sizes },
        'Save failed',
      );
      setCharts((prev) => (prev ?? []).map((c) => (c.id === updated.id ? { ...c, ...updated } : c)));
      message.success('Chart updated');
      setEditingChart(null);
      form.resetFields();
    } catch {
      message.error('Failed to save changes');
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDelete(chart: SizeChart) {
    setDeletingId(chart.id);
    try {
      const { linkedGarmentCount } = await deleteJson<{ linkedGarmentCount: number }>(
        `/api/admin/size-charts/${chart.id}`,
        undefined,
        'Delete failed',
      );
      setCharts((prev) => (prev ?? []).filter((c) => c.id !== chart.id));
      if (linkedGarmentCount > 0) {
        message.warning(`"${chart.name}" deleted. It was linked to ${linkedGarmentCount} garment(s) — those links have been removed.`);
      } else {
        message.success(`"${chart.name}" deleted`);
      }
    } catch {
      message.error('Failed to delete chart');
    } finally {
      setDeletingId(null);
    }
  }

  const columns: ColumnType<SizeChart>[] = [
    {
      title: 'Name',
      dataIndex: 'name',
      render(name: string, record: SizeChart) {
        return (
          <Space>
            {fileIcon(record.storageKey)}
            <Typography.Text strong>{name}</Typography.Text>
          </Space>
        );
      },
    },
    {
      title: 'Description',
      dataIndex: 'description',
      render(v: string | null) {
        return v ? <Typography.Text>{v}</Typography.Text> : <Typography.Text type="secondary">—</Typography.Text>;
      },
    },
    {
      title: 'Kind',
      dataIndex: 'kind',
      width: 110,
      // Customer charts are what customers pick sizes from; production charts
      // carry factory detail for the PO/supplier surfaces.
      filters: KIND_OPTIONS.map((o) => ({ text: o.label, value: o.value })),
      onFilter: (value, record) => record.kind === value,
      render(kind: SizeChartKind) {
        return kindTag(kind ?? 'customer');
      },
    },
    {
      title: 'Type',
      dataIndex: 'storageKey',
      width: 80,
      render(key: string | null) {
        return fileTypeTag(key);
      },
    },
    {
      title: 'Sizes',
      dataIndex: 'sizes',
      render(value: SizeChartSize[]) {
        if (!value || value.length === 0) {
          return <Typography.Text type="secondary">—</Typography.Text>;
        }
        const shown = value.slice(0, 6);
        return (
          <Space wrap size={4}>
            {shown.map((s) => (
              <Tag key={s.label}>{s.tall ? `${s.label} +Tall` : s.label}</Tag>
            ))}
            {value.length > shown.length && <Tag>+{value.length - shown.length}</Tag>}
          </Space>
        );
      },
    },
    {
      title: 'Uploaded',
      dataIndex: 'createdAt',
      width: 140,
      render(v: string) {
        return formatDate(v);
      },
    },
    {
      title: '',
      key: 'actions',
      width: 120,
      render(_: unknown, record: SizeChart) {
        return (
          <Space>
            {record.url && (
              <Tooltip title="View">
                <Button
                  type="text"
                  size="small"
                  icon={<EyeOutlined />}
                  onClick={() => setViewingChart(record)}
                />
              </Tooltip>
            )}
            {canMutate && (
              <Tooltip title="Edit name / description">
                <Button
                  type="text"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => {
                    setEditingChart(record);
                    setSizes(record.sizes ?? []);
                    form.setFieldsValue({
                      name: record.name,
                      description: record.description ?? '',
                      kind: record.kind ?? 'customer',
                    });
                  }}
                />
              </Tooltip>
            )}
            {canMutate && (
              <Popconfirm
                title="Delete this size chart?"
                description="This will also remove it from any garments it is linked to."
                onConfirm={() => handleDelete(record)}
                okText="Delete"
                okType="danger"
                disabled={deletingId !== null}
              >
                <Button
                  type="text"
                  size="small"
                  icon={<DeleteOutlined />}
                  danger
                  loading={deletingId === record.id}
                  disabled={deletingId !== null && deletingId !== record.id}
                />
              </Popconfirm>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <AdminPageHeader
        title="Size Chart Library"
        subtitle="Reusable reference charts that can be linked to garments."
        extra={
          canMutate && (
            <Button type="primary" icon={<UploadOutlined />} onClick={() => { form.resetFields(); setSizes([]); setUploadOpen(true); }}>
              Upload chart
            </Button>
          )
        }
      />

      <Card>
        <Table
          dataSource={charts ?? []}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={false}
          locale={{ emptyText: 'No size charts yet. Upload one to get started.' }}
          size="middle"
        />
      </Card>

      {/* Upload modal */}
      <Modal
        title="Upload Size Chart"
        open={uploadOpen}
        onCancel={() => { setUploadOpen(false); form.resetFields(); }}
        onOk={handleUpload}
        okText="Upload"
        confirmLoading={uploading}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="Chart Name" rules={[{ required: true, message: 'Required' }]}>
            <Input placeholder="Adult Unisex Jersey" />
          </Form.Item>
          <Form.Item name="description" label="Description (optional)">
            <Input placeholder="e.g. For all sublimated jerseys" />
          </Form.Item>
          <Form.Item
            name="kind"
            label="Kind"
            initialValue="customer"
            help="Customer charts show on the customer page; production charts go to the factory on POs"
          >
            <Select options={KIND_OPTIONS} />
          </Form.Item>
          <Form.Item name="file" label="File" rules={[{ required: true, message: 'Select a file' }]}>
            <Upload
              maxCount={1}
              beforeUpload={() => false}
              accept=".pdf,image/jpeg,image/png,image/webp"
            >
              <Button icon={<UploadOutlined />}>Select PDF or Image</Button>
            </Upload>
          </Form.Item>
          <Form.Item
            label="Sizes"
            help="Selectable size options for garments linked to this chart; tick Tall where an extra-long variant exists"
          >
            <SizeListManager value={sizes} onChange={setSizes} />
          </Form.Item>
        </Form>
      </Modal>

      {/* View modal */}
      <Modal
        title={viewingChart?.name}
        open={!!viewingChart}
        onCancel={() => setViewingChart(null)}
        footer={null}
        width="60vw"
        style={{ top: 40 }}
        styles={{ body: { padding: 0, overflow: 'hidden' } }}
        destroyOnHidden
      >
        {viewingChart?.url && isPdf(viewingChart.storageKey) ? (
          <iframe
            src={viewingChart.url}
            style={{ width: '100%', height: 'calc(80vh - 110px)', border: 'none', display: 'block' }}
            title={viewingChart.name}
          />
        ) : viewingChart?.url ? (
          <img
            src={viewingChart.url}
            alt={viewingChart.name}
            style={{
              width: '100%',
              height: 'auto',
              display: 'block',
              cursor: 'zoom-in',
              transformOrigin: 'center center',
              transition: 'transform 0.25s ease',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLImageElement).style.transform = 'scale(1.6)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLImageElement).style.transform = 'scale(1)'; }}
          />
        ) : null}
      </Modal>

      {/* Edit modal */}
      <Modal
        title="Edit Size Chart"
        open={!!editingChart}
        onCancel={() => { setEditingChart(null); form.resetFields(); }}
        onOk={handleEdit}
        okText="Save"
        confirmLoading={editSaving}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="Chart Name" rules={[{ required: true, message: 'Required' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input />
          </Form.Item>
          <Form.Item
            name="kind"
            label="Kind"
            initialValue="customer"
            help="Customer charts show on the customer page; production charts go to the factory on POs"
          >
            <Select options={KIND_OPTIONS} />
          </Form.Item>
          <Form.Item
            label="Sizes"
            help="Selectable size options for garments linked to this chart; tick Tall where an extra-long variant exists"
          >
            <SizeListManager value={sizes} onChange={setSizes} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
