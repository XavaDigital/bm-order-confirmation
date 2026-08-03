'use client';

/**
 * Settings page for the customer confirmation acknowledgments (David,
 * 2026-08-03): edit the wording on the fly, add new ones, deactivate old
 * ones. Each has a TITLE (bold, attention-drawing on the customer page) and
 * the wording beneath. Deactivate-never-delete — past confirmations
 * reference the key and snapshot the agreed text.
 */
import { useState } from 'react';
import {
  App,
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import type { ColumnType } from 'antd/es/table';
import { patchJson, postJson } from '@/lib/api-fetch';
import { useAdminResource } from '@/lib/use-admin-resource';

interface AckSetting {
  id: string;
  key: string;
  title: string;
  body: string;
  sortOrder: number;
  isActive: boolean;
}

interface FormValues {
  title: string;
  body: string;
}

export function AcknowledgementsView({ canMutate }: { canMutate: boolean }) {
  const { message } = App.useApp();
  const { data, loading, error, reload } = useAdminResource<{ items: AckSetting[] }>(
    '/api/admin/acknowledgements',
    { errorMessage: 'Failed to load acknowledgments', toast: false },
  );
  const items = data?.items ?? [];

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AckSetting | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<FormValues>();

  function openAdd() {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
  }

  function openEdit(item: AckSetting) {
    setEditing(item);
    form.setFieldsValue({ title: item.title, body: item.body });
    setModalOpen(true);
  }

  async function save() {
    let values: FormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await patchJson(`/api/admin/acknowledgements/${editing.id}`, values, 'Save failed');
        message.success('Acknowledgment updated — applies to future confirmations');
      } else {
        await postJson('/api/admin/acknowledgements', values, 'Save failed');
        message.success('Acknowledgment added');
      }
      setModalOpen(false);
      reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function setActive(item: AckSetting, isActive: boolean) {
    try {
      await patchJson(`/api/admin/acknowledgements/${item.id}`, { isActive }, 'Update failed');
      reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Update failed');
    }
  }

  /** Swap sortOrder with the neighbour — two PATCHes, order is what matters. */
  async function move(item: AckSetting, direction: -1 | 1) {
    const sorted = [...items].sort((a, b) => a.sortOrder - b.sortOrder);
    const idx = sorted.findIndex((i) => i.id === item.id);
    const neighbour = sorted[idx + direction];
    if (!neighbour) return;
    try {
      await Promise.all([
        patchJson(`/api/admin/acknowledgements/${item.id}`, { sortOrder: neighbour.sortOrder }, 'Reorder failed'),
        patchJson(`/api/admin/acknowledgements/${neighbour.id}`, { sortOrder: item.sortOrder }, 'Reorder failed'),
      ]);
      reload();
    } catch {
      message.error('Reorder failed');
    }
  }

  const columns: ColumnType<AckSetting>[] = [
    {
      title: '',
      key: 'order',
      width: 70,
      render: (_: unknown, item: AckSetting, index: number) => (
        <Space size={0}>
          <Button
            type="text"
            size="small"
            icon={<ArrowUpOutlined />}
            disabled={!canMutate || index === 0}
            aria-label={`Move ${item.title} up`}
            onClick={() => void move(item, -1)}
          />
          <Button
            type="text"
            size="small"
            icon={<ArrowDownOutlined />}
            disabled={!canMutate || index === items.length - 1}
            aria-label={`Move ${item.title} down`}
            onClick={() => void move(item, 1)}
          />
        </Space>
      ),
    },
    {
      title: 'Acknowledgment',
      key: 'text',
      render: (_: unknown, item: AckSetting) => (
        <Space direction="vertical" size={2}>
          <Typography.Text strong>{item.title}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            {item.body}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'isActive',
      width: 110,
      render: (isActive: boolean, item: AckSetting) =>
        canMutate ? (
          <Switch
            checked={isActive}
            onChange={(checked) => void setActive(item, checked)}
            checkedChildren="Active"
            unCheckedChildren="Off"
            aria-label={`${item.title} active`}
          />
        ) : (
          <Tag color={isActive ? 'green' : 'default'}>{isActive ? 'Active' : 'Off'}</Tag>
        ),
    },
    {
      title: '',
      key: 'actions',
      width: 60,
      render: (_: unknown, item: AckSetting) =>
        canMutate && (
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            aria-label={`Edit ${item.title}`}
            onClick={() => openEdit(item)}
          />
        ),
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Typography.Title level={3} style={{ margin: 0, flex: 1 }}>
          Acknowledgments
        </Typography.Title>
        {canMutate && (
          <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>
            Add acknowledgment
          </Button>
        )}
      </div>

      <Alert
        type="info"
        showIcon
        message="These are the checkboxes customers must tick to confirm an order."
        description="Edits apply to future confirmations only — each confirmed order keeps a snapshot of the exact wording that was agreed. Deactivate rather than reword when the meaning changes."
      />

      {error ? (
        <Typography.Text type="danger">{error}</Typography.Text>
      ) : (
        <Table
          dataSource={[...items].sort((a, b) => a.sortOrder - b.sortOrder)}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={false}
        />
      )}

      <Modal
        open={modalOpen}
        title={editing ? `Edit "${editing.title}"` : 'Add an acknowledgment'}
        onOk={() => void save()}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        okText={editing ? 'Save' : 'Add'}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item
            label="Title"
            name="title"
            rules={[{ required: true, message: 'Give it a short title' }]}
            extra="Shown bold above the wording on the customer page."
          >
            <Input placeholder="e.g. Colour accuracy" maxLength={120} />
          </Form.Item>
          <Form.Item
            label="Wording"
            name="body"
            rules={[{ required: true, message: 'The acknowledgment text is required' }]}
          >
            <Input.TextArea rows={4} maxLength={2000} showCount style={{ resize: 'vertical' }} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
