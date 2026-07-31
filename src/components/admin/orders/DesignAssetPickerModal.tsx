'use client';

/**
 * Pull finalised design assets from the order's originating DesignFlow project
 * (fleet thread 2026-07-31): list via a hub-minted read-assets token, pick,
 * then copy the bytes browser-direct — DesignFlow S3 → this browser → our
 * upload route. Bytes never transit the hub or either server (fleet rule).
 *
 * The listing token is short-lived (~15 min); a stale-open picker re-mints by
 * clicking refresh rather than holding a long-lived credential.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Checkbox,
  Empty,
  Modal,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import type { ColumnType } from 'antd/es/table';
import { postForm, postJson } from '@/lib/api-fetch';
import {
  type DesignFlowAsset,
  importedAssetName,
  orderAssetKindFor,
  uploadFilenameFor,
} from './design-asset-import';

interface Props {
  orderId: string;
  open: boolean;
  onClose: () => void;
  /** Called after at least one asset landed, so the panel reloads its list. */
  onImported: () => void;
}

const KIND_TAG: Record<DesignFlowAsset['kind'], { color: string; label: string }> = {
  approved_design: { color: 'geekblue', label: 'Approved design' },
  font: { color: 'purple', label: 'Font' },
  reference: { color: 'default', label: 'Reference' },
};

export function DesignAssetPickerModal({ orderId, open, onClose, onImported }: Props) {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [assets, setAssets] = useState<DesignFlowAsset[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setAssets([]);
    setSelected(new Set());
    try {
      const { token, assetsUrl } = await postJson<{ token: string; assetsUrl: string }>(
        `/api/admin/orders/${orderId}/design-assets/token`,
        {},
        'Could not authorise the pull',
      );
      // Deliberately raw fetch: this is the cross-origin, token-authorised
      // call to DesignFlow's action API — api-fetch is for our own routes.
      const res = await fetch(assetsUrl, { headers: { 'X-Action-Token': token } });
      if (!res.ok) {
        throw new Error(
          res.status === 401 || res.status === 403
            ? 'DesignFlow refused the token — refresh to mint a new one'
            : `DesignFlow could not list the assets (${res.status})`,
        );
      }
      const body = (await res.json()) as { assets: DesignFlowAsset[] };
      setAssets(body.assets);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the design assets');
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function importSelected() {
    const picked = assets.filter((a) => selected.has(a.id));
    if (picked.length === 0) return;
    setImporting(true);
    let imported = 0;
    const failures: string[] = [];

    for (const asset of picked) {
      try {
        // Presigned URLs are short-TTL — a picker left open can outlive them.
        const bytes = await fetch(asset.downloadUrl);
        if (!bytes.ok) {
          throw new Error('download link expired — refresh the list');
        }
        const blob = await bytes.blob();
        const filename = uploadFilenameFor(asset, bytes.headers.get('content-type'));
        if (!filename) {
          throw new Error('unrecognised file type');
        }

        const formData = new FormData();
        formData.set('file', new File([blob], filename, { type: blob.type }));
        const { storageKey } = await postForm<{ storageKey: string }>(
          `/api/admin/orders/${orderId}/assets/upload`,
          formData,
          'upload failed',
        );

        await postJson(`/api/admin/orders/${orderId}/assets`, {
          kind: orderAssetKindFor(asset.kind),
          name: importedAssetName(asset),
          storageKey,
          notes: 'Pulled from DesignFlow',
          // The finalised artwork is what the factory needs; working files stay off the PO.
          includeOnPo: asset.kind === 'approved_design',
        }, 'saving failed');
        imported++;
      } catch (err) {
        failures.push(`${asset.name}: ${err instanceof Error ? err.message : 'failed'}`);
      }
    }

    setImporting(false);
    if (imported > 0) {
      message.success(`${imported} file${imported === 1 ? '' : 's'} added from DesignFlow`);
      onImported();
    }
    if (failures.length > 0) {
      message.error(`Not imported — ${failures.join('; ')}`, 8);
    } else if (imported > 0) {
      onClose();
    }
  }

  const columns: ColumnType<DesignFlowAsset>[] = [
    {
      title: '',
      key: 'pick',
      width: 40,
      render: (_: unknown, asset: DesignFlowAsset) => (
        <Checkbox
          checked={selected.has(asset.id)}
          aria-label={`Select ${asset.name}`}
          onChange={(e) => {
            const next = new Set(selected);
            if (e.target.checked) next.add(asset.id);
            else next.delete(asset.id);
            setSelected(next);
          }}
        />
      ),
    },
    {
      title: '',
      key: 'thumb',
      width: 64,
      render: (_: unknown, asset: DesignFlowAsset) =>
        asset.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived presigned URL; next/image cannot optimise cross-origin signed URLs
          <img
            src={asset.thumbnailUrl}
            alt=""
            style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 4 }}
          />
        ) : null,
    },
    {
      title: 'Asset',
      key: 'name',
      render: (_: unknown, asset: DesignFlowAsset) => (
        <Space direction="vertical" size={0}>
          <Typography.Text>{asset.name}</Typography.Text>
          {(asset.garment || asset.variation) && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {[asset.garment, asset.variation].filter(Boolean).join(' — ')}
            </Typography.Text>
          )}
        </Space>
      ),
    },
    {
      title: 'Type',
      key: 'kind',
      width: 140,
      render: (_: unknown, asset: DesignFlowAsset) => (
        <Tag color={KIND_TAG[asset.kind].color}>{KIND_TAG[asset.kind].label}</Tag>
      ),
    },
  ];

  return (
    <Modal
      open={open}
      title="Pull files from DesignFlow"
      onCancel={onClose}
      width={640}
      footer={[
        <Button key="refresh" icon={<ReloadOutlined />} onClick={() => void load()} disabled={loading || importing}>
          Refresh
        </Button>,
        <Button key="cancel" onClick={onClose} disabled={importing}>
          Cancel
        </Button>,
        <Button
          key="import"
          type="primary"
          onClick={() => void importSelected()}
          loading={importing}
          disabled={selected.size === 0 || loading}
        >
          Add {selected.size > 0 ? `${selected.size} ` : ''}to order
        </Button>,
      ]}
    >
      {loadError ? (
        <Alert type="error" showIcon message={loadError} />
      ) : loading ? (
        <div style={{ textAlign: 'center', padding: 32 }}>
          <Spin />
        </div>
      ) : assets.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No pullable assets — the project has no approved designs, brand fonts, or reference files yet"
        />
      ) : (
        <Table
          dataSource={assets}
          columns={columns}
          rowKey="id"
          size="small"
          pagination={false}
        />
      )}
    </Modal>
  );
}
