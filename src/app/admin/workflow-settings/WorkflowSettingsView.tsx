'use client';

/**
 * Workflow settings — the shape of the boards, and the checks that gate them.
 *
 * Stages are grouped by the STATUS they sit under, because that grouping is the
 * design: a status is fixed (the state machine every consumer depends on) and a
 * stage is a step you can add inside it. Presenting a flat list would invite
 * people to expect they can add statuses, which they cannot.
 *
 * The PO pre-send checklist shares this page because it is the same species of
 * configuration: the steps work has to pass through before it moves on.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  App,
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Segmented,
  Select,
  Skeleton,
  Space,
  Switch,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { PlusOutlined, LockOutlined } from '@ant-design/icons';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { getJson, patchJson, postJson, putJson, ApiError } from '@/lib/api-fetch';
import type { StaffRole } from '@/lib/roles';
import { ORDER_STATUS, PO_STATUS } from '@/lib/status';
import { PoChecklistSettings } from './PoChecklistSettings';
import { AutomationsSettings } from '@/components/admin/workflow-settings/AutomationsSettings';

type BoardKey = 'order' | 'purchase_order';

interface Stage {
  id: string;
  boardKey: BoardKey;
  slug: string;
  name: string;
  statusKey: string;
  sortOrder: number;
  color: string | null;
  isActive: boolean;
  isTerminal: boolean;
  warnAfterHours: number | null;
  urgentAfterHours: number | null;
  defaultConfirmationPolicy: 'any' | 'all';
}

interface Assignee {
  staffUserId: string;
  name: string;
  email: string;
  isActive: boolean;
}

interface StaffUser {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
}

function statusLabel(boardKey: BoardKey, statusKey: string): string {
  const registry: Record<string, { label: string }> =
    boardKey === 'order' ? ORDER_STATUS : PO_STATUS;
  return registry[statusKey]?.label ?? statusKey;
}

type TabKey = 'stages' | 'checklist' | 'automations';

export function WorkflowSettingsView({ role }: { role: StaffRole }) {
  const { message } = App.useApp();
  // Convention: admins mutate, everyone else gets the read-only view.
  const canMutate = role === 'admin';
  const [tab, setTab] = useState<TabKey>('stages');
  const [boardKey, setBoardKey] = useState<BoardKey>('purchase_order');
  const [stages, setStages] = useState<Stage[] | null>(null);
  const [statusKeys, setStatusKeys] = useState<string[]>([]);
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [editing, setEditing] = useState<Stage | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setStages(null);
    try {
      const data = await getJson<{ stages: Stage[]; statusKeys: string[] }>(
        `/api/admin/workflow/stages?boardKey=${boardKey}`,
        'Failed to load stages',
      );
      setStages(data.stages);
      setStatusKeys(data.statusKeys);
    } catch (err) {
      setStages([]);
      message.error(err instanceof Error ? err.message : 'Failed to load stages');
    }
  }, [boardKey, message]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    getJson<StaffUser[]>('/api/admin/users', 'Failed to load users')
      .then((data) => setUsers(data.filter((u) => u.isActive)))
      // Owners are a nice-to-have on this page; failing to load them must not
      // stop someone editing the stages themselves.
      .catch(() => setUsers([]));
  }, []);

  const byStatus = useMemo(() => {
    const groups = new Map<string, Stage[]>();
    for (const key of statusKeys) groups.set(key, []);
    for (const stage of stages ?? []) {
      if (!groups.has(stage.statusKey)) groups.set(stage.statusKey, []);
      groups.get(stage.statusKey)!.push(stage);
    }
    for (const list of groups.values()) list.sort((a, b) => a.sortOrder - b.sortOrder);
    return groups;
  }, [stages, statusKeys]);

  return (
    <div>
      <AdminPageHeader
        title="Workflow settings"
        subtitle="The steps each board is made of, who is responsible for them, and what has to be checked"
        extra={
          // Board controls belong to the board tab — showing them beside the
          // checklist would suggest they act on it.
          tab === 'stages' && (
            <Space>
              <Segmented
                value={boardKey}
                onChange={(v) => setBoardKey(v as BoardKey)}
                size="large"
                options={[
                  { label: 'Purchase Orders', value: 'purchase_order' },
                  { label: 'Orders', value: 'order' },
                ]}
              />
              <Button type="primary" icon={<PlusOutlined />} size="large" onClick={() => setCreating(true)}>
                Add stage
              </Button>
            </Space>
          )
        }
      />

      <Tabs
        activeKey={tab}
        onChange={(key) => setTab(key as TabKey)}
        items={[
          {
            key: 'stages',
            label: 'Board stages',
            children: (
              <>
                <Typography.Paragraph type="secondary">
                  Statuses are fixed — they are the state machine the rest of the system reacts to.
                  Stages are the steps inside a status, and those are yours to change. A card
                  entering a stage notifies that stage&rsquo;s owners.
                </Typography.Paragraph>

                {stages === null ? (
                  <Skeleton active paragraph={{ rows: 8 }} />
                ) : (
                  <Space direction="vertical" size={16} style={{ width: '100%' }}>
                    {[...byStatus.entries()].map(([status, group]) => (
                      <Card
                        key={status}
                        size="small"
                        title={
                          <Space>
                            <span>{statusLabel(boardKey, status)}</span>
                            <Typography.Text type="secondary" style={{ fontWeight: 400, fontSize: 12 }}>
                              status
                            </Typography.Text>
                          </Space>
                        }
                      >
                        {group.length === 0 ? (
                          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No stages" />
                        ) : (
                          <Space direction="vertical" size={8} style={{ width: '100%' }}>
                            {group.map((stage) => (
                              <StageRow key={stage.id} stage={stage} onEdit={() => setEditing(stage)} />
                            ))}
                          </Space>
                        )}
                      </Card>
                    ))}
                  </Space>
                )}
              </>
            ),
          },
          {
            key: 'checklist',
            label: 'PO pre-send checklist',
            children: <PoChecklistSettings canMutate={canMutate} />,
          },
          {
            key: 'automations',
            label: 'Automations',
            children: <AutomationsSettings canMutate={canMutate} />,
          },
        ]}
      />

      <CreateStageDrawer
        open={creating}
        boardKey={boardKey}
        statusKeys={statusKeys}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          void load();
        }}
      />

      <EditStageDrawer
        stage={editing}
        users={users}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void load();
        }}
      />
    </div>
  );
}

function StageRow({ stage, onEdit }: { stage: Stage; onEdit: () => void }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 12px',
        borderRadius: 6,
        border: '1px solid rgba(128,128,128,0.2)',
        opacity: stage.isActive ? 1 : 0.55,
      }}
    >
      {stage.color && (
        <span
          aria-hidden
          style={{ width: 10, height: 10, borderRadius: 3, background: stage.color, flex: '0 0 auto' }}
        />
      )}
      <Typography.Text strong>{stage.name}</Typography.Text>
      <Typography.Text type="secondary" style={{ fontFamily: 'monospace', fontSize: 12 }}>
        {stage.slug}
      </Typography.Text>
      {!stage.isActive && <Tag>retired</Tag>}
      {stage.isTerminal && <Tag color="default">terminal</Tag>}
      {stage.defaultConfirmationPolicy === 'all' && <Tag color="blue">all must confirm</Tag>}
      {stage.warnAfterHours && <Tag color="warning">warn {stage.warnAfterHours}h</Tag>}
      {stage.urgentAfterHours && <Tag color="error">urgent {stage.urgentAfterHours}h</Tag>}
      <span style={{ flex: 1 }} />
      <Button size="small" onClick={onEdit}>
        Edit
      </Button>
    </div>
  );
}

function CreateStageDrawer({
  open,
  boardKey,
  statusKeys,
  onClose,
  onCreated,
}: {
  open: boolean;
  boardKey: BoardKey;
  statusKeys: string[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  async function submit(values: { name: string; statusKey: string }) {
    setSaving(true);
    try {
      await postJson('/api/admin/workflow/stages', { ...values, boardKey }, 'Failed to add stage');
      message.success('Stage added');
      form.resetFields();
      onCreated();
    } catch (err) {
      message.error(err instanceof ApiError || err instanceof Error ? err.message : 'Failed to add stage');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer title="Add stage" open={open} onClose={onClose} width={420} destroyOnClose>
      <Form form={form} layout="vertical" onFinish={submit} requiredMark={false}>
        <Form.Item label="Name" name="name" rules={[{ required: true, message: 'Give the stage a name' }]}>
          <Input placeholder="Digitising" autoFocus />
        </Form.Item>
        <Form.Item
          label="Sits under status"
          name="statusKey"
          rules={[{ required: true, message: 'Pick the status this step belongs to' }]}
          extra="A stage is a step inside a status. The statuses themselves are fixed."
        >
          <Select
            options={statusKeys.map((key) => ({ value: key, label: statusLabel(boardKey, key) }))}
          />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={saving} block>
          Add stage
        </Button>
      </Form>
    </Drawer>
  );
}

function EditStageDrawer({
  stage,
  users,
  onClose,
  onSaved,
}: {
  stage: Stage | null;
  users: StaffUser[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [ownerIds, setOwnerIds] = useState<string[]>([]);

  useEffect(() => {
    if (!stage) return;
    form.setFieldsValue(stage);
    // Owners are fetched per stage rather than for the whole board: the list
    // page does not show them, so loading them all would be N+1 for nothing.
    getJson<Assignee[]>(
      `/api/admin/workflow/assignees?entityType=workflow_stage&entityId=${stage.id}`,
      'Failed to load owners',
    )
      .then((rows) => setOwnerIds(rows.map((r) => r.staffUserId)))
      .catch(() => setOwnerIds([]));
  }, [stage, form]);

  async function submit(values: Partial<Stage>) {
    if (!stage) return;
    setSaving(true);
    try {
      await patchJson(`/api/admin/workflow/stages/${stage.id}`, values, 'Failed to save stage');
      await putJson(
        '/api/admin/workflow/assignees',
        { entityType: 'workflow_stage', entityId: stage.id, staffUserIds: ownerIds },
        'Failed to save owners',
      );
      message.success('Stage saved');
      onSaved();
    } catch (err) {
      message.error(err instanceof ApiError || err instanceof Error ? err.message : 'Failed to save stage');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer title={stage?.name ?? 'Stage'} open={stage !== null} onClose={onClose} width={460} destroyOnClose>
      {stage && (
        <Form form={form} layout="vertical" onFinish={submit} requiredMark={false}>
          <Form.Item label="Name" name="name" rules={[{ required: true, message: 'Give the stage a name' }]}>
            <Input />
          </Form.Item>

          <Form.Item label="Owners" extra="They are notified when a job reaches this stage.">
            <Select
              mode="multiple"
              value={ownerIds}
              onChange={setOwnerIds}
              optionFilterProp="label"
              placeholder="Nobody assigned"
              options={users.map((u) => ({ value: u.id, label: `${u.name} (${u.email})` }))}
            />
          </Form.Item>

          <Form.Item
            label="Sign-off"
            name="defaultConfirmationPolicy"
            extra="“All must confirm” is how a checked-and-double-checked step is expressed."
          >
            <Select
              options={[
                { value: 'any', label: 'Any one owner can confirm' },
                { value: 'all', label: 'All owners must confirm' },
              ]}
            />
          </Form.Item>

          <Space size={12} style={{ display: 'flex' }}>
            <Form.Item label="Warn after (hours)" name="warnAfterHours" style={{ flex: 1 }}>
              <InputNumber min={1} placeholder="default" style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="Urgent after (hours)" name="urgentAfterHours" style={{ flex: 1 }}>
              <InputNumber min={1} placeholder="default" style={{ width: '100%' }} />
            </Form.Item>
          </Space>

          <Form.Item label="Colour" name="color">
            <Input placeholder="#4f46e5" allowClear />
          </Form.Item>

          <Form.Item label="In use" name="isActive" valuePropName="checked">
            <Switch
              checkedChildren="Active"
              unCheckedChildren="Retired"
              disabled={isProtectedSlug(stage)}
            />
          </Form.Item>
          {isProtectedSlug(stage) && (
            <Typography.Paragraph type="secondary" style={{ marginTop: -12 }}>
              <Tooltip title="Every card in this status falls back to this stage">
                <LockOutlined />
              </Tooltip>{' '}
              This is the fallback stage for its status, so it cannot be retired. Renaming it is
              fine — cards reference <code>{stage.slug}</code>, not the name.
            </Typography.Paragraph>
          )}

          <Button type="primary" htmlType="submit" loading={saving} block>
            Save
          </Button>
        </Form>
      )}
    </Drawer>
  );
}

/**
 * Mirrors PROTECTED_STAGE_SLUGS server-side. This only hides an affordance —
 * the server refuses the change regardless, which is what actually protects the
 * board.
 */
function isProtectedSlug(stage: Stage): boolean {
  const protectedSlugs: Record<BoardKey, string[]> = {
    order: ['draft', 'sent', 'viewed', 'changes_requested', 'confirmed', 'cancelled'],
    purchase_order: [
      'draft',
      'sent',
      'confirmed',
      'pre_production',
      'in_production',
      'in_transit',
      'received',
      'completed',
      'remake',
      'cancelled',
    ],
  };
  return protectedSlugs[stage.boardKey].includes(stage.slug);
}
