'use client';

/**
 * The order→design-project link, editable (fleet thread 2026-07-31/08-01).
 *
 * Stores DesignFlow's project uuid (rename/merge-stable — their D3
 * commitment), picked from the HUB customer's projects via their design_tool
 * external reference. The link is what the asset picker mints against and
 * what the header chip deep-links to; an order created by the email relay
 * may arrive with it pre-set, this control covers every other order.
 */
import { useEffect, useState } from 'react';
import { App, Button, Modal, Select, Space, Tag, Tooltip, Typography } from 'antd';
import { DisconnectOutlined, EditOutlined, LinkOutlined } from '@ant-design/icons';
import { getJson, patchJson } from '@/lib/api-fetch';

interface HubProjectOption {
  hubProjectId: string;
  name: string;
  designStatus?: string | null;
  designProjectRef: string | null;
}

interface Props {
  orderId: string;
  hubCustomerId?: string | null;
  designProjectRef?: string | null;
  /** Parent refresh (router.refresh()) after a successful link change. */
  onChanged: () => void;
}

export function DesignProjectLinkControl({
  orderId,
  hubCustomerId,
  designProjectRef,
  onChanged,
}: Props) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [projects, setProjects] = useState<HubProjectOption[]>([]);
  const [picked, setPicked] = useState<string | null>(designProjectRef ?? null);

  useEffect(() => {
    if (!open || !hubCustomerId) return;
    setLoading(true);
    getJson<{ projects: HubProjectOption[] }>(
      `/api/admin/hub/customers/${hubCustomerId}/projects`,
      'Could not load the customer’s design projects',
    )
      .then((body) => setProjects(body.projects))
      .catch((err) =>
        message.error(err instanceof Error ? err.message : 'Could not load design projects'),
      )
      .finally(() => setLoading(false));
  }, [open, hubCustomerId, message]);

  async function save(ref: string | null) {
    setSaving(true);
    try {
      await patchJson(
        `/api/admin/orders/${orderId}`,
        { designProjectRef: ref },
        'Could not update the design-project link',
      );
      message.success(ref ? 'Design project linked' : 'Design project unlinked');
      setOpen(false);
      onChanged();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Could not update the link');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {designProjectRef ? (
        <Space size={0}>
          <Tooltip title="Open the originating design project in DesignFlow">
            {/* One-way pointer — DesignFlow's uuid is rename/merge-stable and
                the URL format is their committed contract (fleet thread D3). */}
            <a
              href={`https://designflow.beastmode.co.nz/projects/${designProjectRef}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Tag icon={<LinkOutlined />} color="purple">
                Design project
              </Tag>
            </a>
          </Tooltip>
          {hubCustomerId && (
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              aria-label="Change the linked design project"
              onClick={() => {
                setPicked(designProjectRef);
                setOpen(true);
              }}
            />
          )}
        </Space>
      ) : hubCustomerId ? (
        <Button
          size="small"
          type="dashed"
          icon={<LinkOutlined />}
          onClick={() => {
            setPicked(null);
            setOpen(true);
          }}
        >
          Link design project
        </Button>
      ) : null}

      <Modal
        open={open}
        title="Link a design project"
        onCancel={() => setOpen(false)}
        confirmLoading={saving}
        onOk={() => void save(picked)}
        okText="Save link"
        okButtonProps={{ disabled: picked === (designProjectRef ?? null) }}
        footer={(_, { OkBtn, CancelBtn }) => (
          <Space>
            {designProjectRef && (
              <Button
                danger
                icon={<DisconnectOutlined />}
                loading={saving}
                onClick={() => void save(null)}
              >
                Unlink
              </Button>
            )}
            <CancelBtn />
            <OkBtn />
          </Space>
        )}
      >
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Typography.Text type="secondary">
            The Sales Hub customer&apos;s design projects. Only projects that exist in
            DesignFlow can be linked — the link powers the header chip and the
            pull-files-from-DesignFlow picker.
          </Typography.Text>
          <Select
            style={{ width: '100%' }}
            loading={loading}
            value={picked ?? undefined}
            placeholder="Choose a design project"
            onChange={(value) => setPicked(value)}
            options={projects.map((p) => ({
              value: p.designProjectRef ?? `__none__${p.hubProjectId}`,
              disabled: !p.designProjectRef,
              label: p.designProjectRef
                ? `${p.name}${p.designStatus ? ` — ${p.designStatus}` : ''}`
                : `${p.name} (not in DesignFlow)`,
            }))}
            notFoundContent={
              loading ? 'Loading…' : 'No design projects on this customer yet'
            }
          />
        </Space>
      </Modal>
    </>
  );
}
