'use client';

/**
 * Design + font files on an order: named links (Drive URLs) that the factory and
 * the next reprint need. Order-wide by default, optionally tagged to a garment.
 * Assets marked "Send to supplier" are captured into each PO revision snapshot.
 */
import { useState } from 'react';
import {
  App,
  AutoComplete,
  Button,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd';
import {
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  LinkOutlined,
  PaperClipOutlined,
  PlusOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import type { ColumnType } from 'antd/es/table';
import { deleteJson, patchJson, postForm, postJson } from '@/lib/api-fetch';
import { SectionTitle } from '@/components/admin/SectionTitle';
import { useAdminResource } from '@/lib/use-admin-resource';
import { ASSET_KIND_COLOR, ASSET_KIND_LABEL } from '@/lib/asset-kind';
import type { OrderAssetKind } from '@/db/schema';
import { DesignAssetPickerModal } from './DesignAssetPickerModal';

export interface OrderAsset {
  id: string;
  kind: OrderAssetKind;
  name: string;
  url: string | null;
  storageKey?: string | null;
  /** What the file is for — 'Player Name', or a custom column label. */
  usage?: string | null;
  notes: string | null;
  garmentId: string | null;
  includeOnPo: boolean;
  sortOrder: number;
  garment?: { id: string; name: string } | null;
  /** The Drive URL, or a short-lived signed URL for an uploaded file. */
  downloadUrl?: string | null;
}

interface Props {
  orderId: string;
  garments: Array<{ id: string; name: string }>;
  /** The originating DesignFlow project — enables the pull-from-DesignFlow picker. */
  designProjectRef?: string | null;
}

interface FormValues {
  kind: OrderAssetKind;
  name: string;
  url?: string;
  usage?: string;
  notes?: string;
  garmentId?: string | null;
  includeOnPo: boolean;
}

/**
 * Suggestions only — the field stays free text because it can also name any
 * user-defined sizing column ('Secondary Name'), and those vary per garment.
 */
const USAGE_SUGGESTIONS = [{ value: 'Player Name' }, { value: 'Player Number' }];

export function OrderAssetsPanel({ orderId, garments, designProjectRef }: Props) {
  const { message } = App.useApp();
  const [pickerOpen, setPickerOpen] = useState(false);
  const { data, loading, error, reload } = useAdminResource<OrderAsset[]>(
    `/api/admin/orders/${orderId}/assets`,
    { errorMessage: 'Failed to load design files', toast: false },
  );
  const assets = data ?? [];

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<OrderAsset | null>(null);
  const [saving, setSaving] = useState(false);
  const [source, setSource] = useState<'link' | 'upload'>('link');
  /** Set once the bytes are in storage; the row is created/patched with it. */
  const [uploadedKey, setUploadedKey] = useState<string | null>(null);
  const [uploadedName, setUploadedName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [form] = Form.useForm<FormValues>();

  function openAdd() {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ kind: 'design', includeOnPo: false, garmentId: null });
    setSource('link');
    setUploadedKey(null);
    setUploadedName(null);
    setModalOpen(true);
  }

  function openEdit(asset: OrderAsset) {
    setEditing(asset);
    form.setFieldsValue({
      kind: asset.kind,
      name: asset.name,
      url: asset.url ?? undefined,
      usage: asset.usage ?? undefined,
      notes: asset.notes ?? undefined,
      garmentId: asset.garmentId,
      includeOnPo: asset.includeOnPo,
    });
    setSource(asset.storageKey ? 'upload' : 'link');
    // The existing upload counts as "already provided" — saving without
    // touching the file keeps it.
    setUploadedKey(asset.storageKey ?? null);
    setUploadedName(asset.storageKey ? asset.name : null);
    setModalOpen(true);
  }

  /** Push the bytes up as soon as the file is picked, not on save — the user
   *  sees the failure next to the control that caused it. */
  async function uploadPicked(file: File): Promise<void> {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.set('file', file);
      const res = await postForm<{ storageKey: string; filename: string }>(
        `/api/admin/orders/${orderId}/assets/upload`,
        formData,
        'Upload failed',
      );
      setUploadedKey(res.storageKey);
      setUploadedName(res.filename);
      // Prefill the display name from the filename, minus its extension —
      // only if staff haven't already typed one.
      if (!form.getFieldValue('name')) {
        form.setFieldsValue({ name: res.filename.replace(/\.[^.]+$/, '') });
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    let values: FormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    if (source === 'upload' && !uploadedKey) {
      message.error('Upload a file, or switch to a link');
      return;
    }

    const body = {
      kind: values.kind,
      name: values.name,
      // One or the other, never both — the service clears the replaced side.
      ...(source === 'link' ? { url: values.url } : { storageKey: uploadedKey }),
      usage: values.usage?.trim() ? values.usage : null,
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
      render: (kind: OrderAssetKind) => <Tag color={ASSET_KIND_COLOR[kind]}>{ASSET_KIND_LABEL[kind]}</Tag>,
    },
    {
      title: 'Name',
      dataIndex: 'name',
      render: (name: string, asset: OrderAsset) => (
        <Space direction="vertical" size={0}>
          {/* downloadUrl is the enriched field; url is the fallback so a plain
              row (tests, older callers) still links. */}
          {(asset.downloadUrl ?? asset.url) ? (
            <a href={asset.downloadUrl ?? asset.url ?? undefined} target="_blank" rel="noopener noreferrer">
              <Space size={4}>
                {asset.storageKey ? <PaperClipOutlined /> : <LinkOutlined />}
                {name}
              </Space>
            </a>
          ) : (
            // An uploaded file whose signed URL could not be minted just now —
            // still a real row, just not clickable this refresh.
            <Space size={4}>
              <PaperClipOutlined />
              {name}
            </Space>
          )}
          {asset.usage && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              for {asset.usage}
            </Typography.Text>
          )}
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
        <SectionTitle style={{ margin: 0, flex: 1 }}>Design &amp; font files</SectionTitle>
        {designProjectRef && (
          <Button icon={<DownloadOutlined />} onClick={() => setPickerOpen(true)}>
            Pull from DesignFlow
          </Button>
        )}
        <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>
          Add file
        </Button>
      </div>

      {designProjectRef && (
        <DesignAssetPickerModal
          orderId={orderId}
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onImported={reload}
        />
      )}

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
          <Form.Item label="File source">
            <Radio.Group
              value={source}
              onChange={(e) => setSource(e.target.value)}
              options={[
                { value: 'link', label: 'Link (Drive)' },
                { value: 'upload', label: 'Upload' },
              ]}
              optionType="button"
            />
          </Form.Item>
          {source === 'link' ? (
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
          ) : (
            <Form.Item
              label="File"
              extra="Fonts (OTF, TTF, WOFF) and design files (AI, EPS, PDF, SVG, PNG). Sent to the supplier as an email attachment."
            >
              <Space direction="vertical" size={4}>
                <Upload
                  maxCount={1}
                  showUploadList={false}
                  // The route validates by extension server-side; no accept
                  // filter here so a mislabelled-but-valid file still gets through.
                  beforeUpload={(file) => {
                    void uploadPicked(file);
                    return false; // we upload ourselves — antd must not also try
                  }}
                >
                  <Button icon={<UploadOutlined />} loading={uploading}>
                    {uploadedKey ? 'Replace file' : 'Choose file'}
                  </Button>
                </Upload>
                {uploadedName && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    <PaperClipOutlined /> {uploadedName}
                  </Typography.Text>
                )}
              </Space>
            </Form.Item>
          )}
          <Form.Item
            label="Used for"
            name="usage"
            extra="Which text this font is for — Player Name, Player Number, or one of your custom columns."
          >
            <AutoComplete
              options={USAGE_SUGGESTIONS}
              placeholder="e.g. Player Number"
              allowClear
              maxLength={120}
            />
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
