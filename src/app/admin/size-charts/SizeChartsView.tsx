'use client';

import { useState, useEffect } from 'react';
import {
  Table,
  Button,
  Form,
  Input,
  Upload,
  Space,
  Typography,
  Popconfirm,
  message,
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
  LinkOutlined,
} from '@ant-design/icons';
import type { ColumnType } from 'antd/es/table';

interface SizeChart {
  id: string;
  name: string;
  description: string | null;
  storageKey: string | null;
  createdAt: string;
  url: string | null;
}

function fileIcon(storageKey: string | null) {
  if (!storageKey) return null;
  return storageKey.endsWith('.pdf') ? (
    <FilePdfOutlined style={{ color: '#ff4d4f', marginRight: 6 }} />
  ) : (
    <FileImageOutlined style={{ color: '#1677ff', marginRight: 6 }} />
  );
}

export function SizeChartsView() {
  const [charts, setCharts] = useState<SizeChart[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editingChart, setEditingChart] = useState<SizeChart | null>(null);
  const [form] = Form.useForm();
  const [uploading, setUploading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);

  async function fetchCharts() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/size-charts');
      if (!res.ok) throw new Error('Failed to load');
      setCharts(await res.json());
    } catch {
      message.error('Failed to load size charts');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchCharts(); }, []);

  async function handleUpload() {
    let values: { name: string; description?: string; file?: { file: File } };
    try { values = await form.validateFields(); } catch { return; }

    const file = values.file?.file;
    if (!file) { message.error('Please select a file'); return; }

    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('name', values.name);
      if (values.description) fd.append('description', values.description);
      fd.append('file', file);

      const res = await fetch('/api/admin/size-charts', { method: 'POST', body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? 'Upload failed');
      }
      const chart: SizeChart = await res.json();
      setCharts((prev) => [chart, ...prev]);
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
    let values: { name: string; description?: string };
    try { values = await form.validateFields(); } catch { return; }

    setEditSaving(true);
    try {
      const res = await fetch(`/api/admin/size-charts/${editingChart.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: values.name, description: values.description ?? null }),
      });
      if (!res.ok) throw new Error('Save failed');
      const updated: SizeChart = await res.json();
      setCharts((prev) => prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)));
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
    try {
      const res = await fetch(`/api/admin/size-charts/${chart.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      const { linkedGarmentCount }: { linkedGarmentCount: number } = await res.json();
      setCharts((prev) => prev.filter((c) => c.id !== chart.id));
      if (linkedGarmentCount > 0) {
        message.warning(`"${chart.name}" deleted. It was linked to ${linkedGarmentCount} garment(s) — those links have been removed.`);
      } else {
        message.success(`"${chart.name}" deleted`);
      }
    } catch {
      message.error('Failed to delete chart');
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
      title: 'Type',
      dataIndex: 'storageKey',
      width: 80,
      render(key: string | null) {
        if (!key) return null;
        return key.endsWith('.pdf') ? (
          <Tag color="red">PDF</Tag>
        ) : (
          <Tag color="blue">Image</Tag>
        );
      },
    },
    {
      title: 'Uploaded',
      dataIndex: 'createdAt',
      width: 140,
      render(v: string) {
        return new Date(v).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' });
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
              <Tooltip title="Open file">
                <a href={record.url} target="_blank" rel="noopener noreferrer">
                  <Button type="text" size="small" icon={<LinkOutlined />} />
                </a>
              </Tooltip>
            )}
            <Tooltip title="Edit name / description">
              <Button
                type="text"
                size="small"
                icon={<EditOutlined />}
                onClick={() => {
                  setEditingChart(record);
                  form.setFieldsValue({ name: record.name, description: record.description ?? '' });
                }}
              />
            </Tooltip>
            <Popconfirm
              title="Delete this size chart?"
              description="This will also remove it from any garments it is linked to."
              onConfirm={() => handleDelete(record)}
              okText="Delete"
              okType="danger"
            >
              <Button type="text" size="small" icon={<DeleteOutlined />} danger />
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <Typography.Title level={3} style={{ marginBottom: 4 }}>Size Chart Library</Typography.Title>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            Reusable reference charts that can be linked to garments.
          </Typography.Paragraph>
        </div>
        <Button type="primary" icon={<UploadOutlined />} onClick={() => { form.resetFields(); setUploadOpen(true); }}>
          Upload chart
        </Button>
      </div>

      <Card>
        <Table
          dataSource={charts}
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
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="Chart Name" rules={[{ required: true, message: 'Required' }]}>
            <Input placeholder="Adult Unisex Jersey" />
          </Form.Item>
          <Form.Item name="description" label="Description (optional)">
            <Input placeholder="e.g. For all sublimated jerseys" />
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
        </Form>
      </Modal>

      {/* Edit modal */}
      <Modal
        title="Edit Size Chart"
        open={!!editingChart}
        onCancel={() => { setEditingChart(null); form.resetFields(); }}
        onOk={handleEdit}
        okText="Save"
        confirmLoading={editSaving}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="Chart Name" rules={[{ required: true, message: 'Required' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
