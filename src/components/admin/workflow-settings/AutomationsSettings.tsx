'use client';

/**
 * Automations settings (David, 2026-08-06) — "when this happens, do that",
 * configured by staff rather than deployed by us.
 *
 * The whole risk of a configurable automation is that nobody can tell what it
 * will DO. So the list is not a dump of trigger/action codes: every rule is
 * rendered as one English sentence built by `describeAutomation`, and the same
 * sentence is shown live while the rule is being written. If a rule cannot be
 * said in a sentence, it should not be savable — which is why the vocabulary is
 * a small closed list (see src/server/automations/service.ts) and why the
 * describer degrades to plain words rather than blanks when a config is missing.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  App,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Select,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { FormInstance } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { ApiError, getJson, patchJson, postJson } from '@/lib/api-fetch';
import { PO_STATUS, poStatusMeta } from '@/lib/status';
import { PO_FILE_CATEGORIES } from '@/server/purchase-orders/files-contract';

const { Text } = Typography;

const AUTOMATIONS_URL = '/api/admin/automations';

export type AutomationTrigger =
  | 'po_status_changed'
  | 'po_file_uploaded'
  | 'po_checklist_complete';
export type AutomationAction = 'notify' | 'set_status' | 'add_note';

export interface AutomationRuleRow {
  id: string;
  name: string;
  trigger: AutomationTrigger | string;
  triggerConfig: Record<string, string> | null;
  action: AutomationAction | string;
  actionConfig: Record<string, unknown> | null;
  isActive: boolean;
}

/** What `describeAutomation` needs — a saved rule, or a half-written one. */
export interface DescribableAutomation {
  trigger?: string | null;
  triggerConfig?: Record<string, string> | null;
  action?: string | null;
  actionConfig?: Record<string, unknown> | null;
}

/** Short names for the trigger Select — the sentence says it properly. */
export const TRIGGER_LABELS: Record<AutomationTrigger, string> = {
  po_status_changed: 'A purchase order reaches a status',
  po_file_uploaded: 'A file is uploaded to a purchase order',
  po_checklist_complete: 'The pre-send checklist is completed',
};

export const ACTION_LABELS: Record<AutomationAction, string> = {
  notify: 'Notify people',
  set_status: 'Move the purchase order to a status',
  add_note: 'Add a note to the order',
};

/**
 * Recipients are named the way someone would say them out loud. Roles are
 * groups ("the admins"), the other two are relationships to this particular
 * purchase order.
 */
export const RECIPIENT_LABELS: Record<string, string> = {
  admin: 'the admins',
  sales: 'the sales team',
  viewer: 'the viewers',
  po_creator: 'whoever created the purchase order',
  supplier: 'the supplier',
};

/** Longest note preview the sentence carries before it stops being a sentence. */
const NOTE_PREVIEW_CHARS = 60;

function joinWithAnd(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function statusLabel(value: unknown): string | null {
  const key = typeof value === 'string' ? value.trim() : '';
  // poStatusMeta falls back to the raw value, so an unknown status still reads
  // as something rather than vanishing from the sentence.
  return key ? poStatusMeta(key).label : null;
}

/** Cut a long note back to the last whole word — a half word reads as a typo. */
function previewNote(body: string): string {
  if (body.length <= NOTE_PREVIEW_CHARS) return body;
  const cut = body.slice(0, NOTE_PREVIEW_CHARS);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > NOTE_PREVIEW_CHARS / 3 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function triggerClause(rule: DescribableAutomation): string {
  const config = rule.triggerConfig ?? {};
  switch (rule.trigger) {
    case 'po_status_changed': {
      const label = statusLabel(config.to);
      return label
        ? `When a purchase order moves to ${label}`
        : 'When a purchase order changes status';
    }
    case 'po_file_uploaded': {
      const category = typeof config.category === 'string' ? config.category.trim() : '';
      return category
        ? `When a ${category} is uploaded to a purchase order`
        : 'When any file is uploaded to a purchase order';
    }
    case 'po_checklist_complete':
      return 'When the pre-send checklist is complete';
    default:
      // Unknown/absent trigger: still a sentence, and it names the value so a
      // rule written by an older (or newer) version can be recognised.
      return rule.trigger
        ? `When “${rule.trigger}” happens`
        : 'When something happens';
  }
}

function actionClause(rule: DescribableAutomation): string {
  const config = rule.actionConfig ?? {};
  switch (rule.action) {
    case 'notify': {
      const raw = Array.isArray(config.recipients) ? (config.recipients as unknown[]) : [];
      const names = raw
        .filter((r): r is string => typeof r === 'string' && r.trim() !== '')
        .map((r) => RECIPIENT_LABELS[r] ?? r);
      return names.length > 0 ? `notify ${joinWithAnd(names)}` : 'notify nobody yet';
    }
    case 'set_status': {
      const label = statusLabel(config.status);
      return label
        ? `move the purchase order to ${label}`
        : 'move the purchase order (no status chosen yet)';
    }
    case 'add_note': {
      const body = typeof config.body === 'string' ? config.body.replace(/\s+/g, ' ').trim() : '';
      if (!body) return 'add a note (nothing written yet)';
      return `add a note: “${previewNote(body)}”`;
    }
    default:
      return rule.action ? `do “${rule.action}”` : 'do nothing yet';
  }
}

/**
 * One rule as one sentence: "When X → do Y".
 *
 * Pure and total — every unknown or missing piece has plain words of its own,
 * because a half-written rule is exactly when someone most needs to read what
 * it would do.
 */
export function describeAutomation(rule: DescribableAutomation): string {
  return `${triggerClause(rule)} → ${actionClause(rule)}`;
}

interface FormValues {
  name: string;
  trigger: AutomationTrigger;
  /** po_status_changed */
  toStatus?: string;
  /** po_file_uploaded — optional; blank means any file. */
  category?: string;
  action: AutomationAction;
  /** set_status */
  status?: string;
  /** notify */
  recipients?: string[];
  /** add_note */
  body?: string;
}

function toTriggerConfig(values: FormValues): Record<string, string> {
  if (values.trigger === 'po_status_changed') {
    return values.toStatus ? { to: values.toStatus } : {};
  }
  if (values.trigger === 'po_file_uploaded') {
    return values.category ? { category: values.category } : {};
  }
  return {};
}

function toActionConfig(values: FormValues): Record<string, unknown> {
  if (values.action === 'set_status') return { status: values.status ?? '' };
  if (values.action === 'notify') return { recipients: values.recipients ?? [] };
  if (values.action === 'add_note') return { body: values.body ?? '' };
  return {};
}

const STATUS_OPTIONS = Object.entries(PO_STATUS).map(([value, meta]) => ({
  value,
  label: meta.label,
}));

const CATEGORY_OPTIONS = PO_FILE_CATEGORIES.map((c) => ({ value: c, label: c }));

const RECIPIENT_OPTIONS = Object.entries(RECIPIENT_LABELS).map(([value, label]) => ({
  value,
  label,
}));

export function AutomationsSettings({ canMutate }: { canMutate: boolean }) {
  const { message } = App.useApp();
  const [rules, setRules] = useState<AutomationRuleRow[] | null>(null);
  const [editing, setEditing] = useState<AutomationRuleRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingRowId, setSavingRowId] = useState<string | null>(null);
  const [form] = Form.useForm<FormValues>();

  const load = useCallback(async () => {
    try {
      const data = await getJson<{ items: AutomationRuleRow[] }>(
        AUTOMATIONS_URL,
        'Failed to load automations',
      );
      setRules(data.items);
    } catch (err) {
      setRules([]);
      message.error(err instanceof Error ? err.message : 'Failed to load automations');
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  /** The in-use switch is a one-field change — no modal for a toggle. */
  async function toggleActive(rule: AutomationRuleRow, isActive: boolean) {
    setSavingRowId(rule.id);
    try {
      const saved = await patchJson<AutomationRuleRow>(
        AUTOMATIONS_URL,
        { id: rule.id, isActive },
        'Failed to save the automation',
      );
      setRules((rows) => (rows ?? []).map((r) => (r.id === rule.id ? saved : r)));
    } catch (err) {
      message.error(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'Failed to save the automation',
      );
    } finally {
      setSavingRowId(null);
    }
  }

  function openCreate() {
    form.setFieldsValue({
      name: '',
      trigger: 'po_status_changed',
      toStatus: undefined,
      category: undefined,
      action: 'notify',
      status: undefined,
      recipients: [],
      body: '',
    });
    setCreating(true);
  }

  function openEdit(rule: AutomationRuleRow) {
    const triggerConfig = rule.triggerConfig ?? {};
    const actionConfig = (rule.actionConfig ?? {}) as Record<string, unknown>;
    form.setFieldsValue({
      name: rule.name,
      trigger: rule.trigger as AutomationTrigger,
      toStatus: triggerConfig.to,
      category: triggerConfig.category,
      action: rule.action as AutomationAction,
      status: typeof actionConfig.status === 'string' ? actionConfig.status : undefined,
      recipients: Array.isArray(actionConfig.recipients)
        ? (actionConfig.recipients as string[])
        : [],
      body: typeof actionConfig.body === 'string' ? actionConfig.body : '',
    });
    setEditing(rule);
  }

  function closeModal() {
    setCreating(false);
    setEditing(null);
  }

  async function submit(values: FormValues) {
    const payload = {
      name: values.name.trim(),
      trigger: values.trigger,
      triggerConfig: toTriggerConfig(values),
      action: values.action,
      actionConfig: toActionConfig(values),
    };
    setSaving(true);
    try {
      if (editing) {
        await patchJson(
          AUTOMATIONS_URL,
          { id: editing.id, ...payload },
          'Failed to save the automation',
        );
        message.success('Automation saved');
      } else {
        await postJson(AUTOMATIONS_URL, { ...payload, isActive: true }, 'Failed to add the automation');
        message.success('Automation added');
      }
      closeModal();
      await load();
    } catch (err) {
      message.error(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'Failed to save the automation',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card
      size="small"
      title="Automations"
      extra={
        canMutate && (
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            Add automation
          </Button>
        )
      }
    >
      <Typography.Paragraph type="secondary">
        Automations run themselves when something happens on a purchase order. Every rule reads as
        a sentence, and every time one fires it is recorded against the order by name — an
        automatic move is never anonymous. A move the purchase order is not allowed to make is
        skipped and logged rather than forced.
      </Typography.Paragraph>

      <Table<AutomationRuleRow>
        rowKey="id"
        size="small"
        pagination={false}
        loading={rules === null}
        dataSource={rules ?? []}
        locale={{ emptyText: 'No automations yet.' }}
        columns={[
          {
            title: 'Name',
            dataIndex: 'name',
            width: 220,
            render: (name: string, row) => (
              <span style={{ opacity: row.isActive ? 1 : 0.55 }}>
                <Text strong={row.isActive}>{name}</Text>
                {!row.isActive && <Tag style={{ marginInlineStart: 8 }}>paused</Tag>}
              </span>
            ),
          },
          {
            title: 'What it does',
            key: 'sentence',
            render: (_: unknown, row) => (
              <Text type={row.isActive ? undefined : 'secondary'} data-testid={`rule-sentence-${row.id}`}>
                {describeAutomation(row)}
              </Text>
            ),
          },
          {
            title: 'In use',
            dataIndex: 'isActive',
            width: 110,
            render: (isActive: boolean, row) => (
              <Switch
                checked={isActive}
                disabled={!canMutate}
                loading={savingRowId === row.id}
                aria-label={`In use: ${row.name}`}
                onChange={(checked) => void toggleActive(row, checked)}
              />
            ),
          },
          ...(canMutate
            ? [
                {
                  title: '',
                  key: 'actions',
                  width: 80,
                  render: (_: unknown, row: AutomationRuleRow) => (
                    <Button size="small" onClick={() => openEdit(row)}>
                      Edit
                    </Button>
                  ),
                },
              ]
            : []),
        ]}
      />

      <AutomationModal
        open={creating || editing !== null}
        editing={editing !== null}
        form={form}
        saving={saving}
        onCancel={closeModal}
        onSubmit={submit}
      />
    </Card>
  );
}

function AutomationModal({
  open,
  editing,
  form,
  saving,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  editing: boolean;
  form: FormInstance<FormValues>;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (values: FormValues) => void | Promise<void>;
}) {
  // Watched so the preview sentence tracks the form as it is written — the
  // point of the panel is that nobody saves a rule they cannot read.
  const trigger = Form.useWatch('trigger', form);
  const action = Form.useWatch('action', form);
  const toStatus = Form.useWatch('toStatus', form);
  const category = Form.useWatch('category', form);
  const status = Form.useWatch('status', form);
  const recipients = Form.useWatch('recipients', form);
  const body = Form.useWatch('body', form);

  const preview = useMemo(
    () =>
      describeAutomation({
        trigger,
        triggerConfig: toTriggerConfig({ trigger, toStatus, category } as FormValues),
        action,
        actionConfig: toActionConfig({ action, status, recipients, body } as FormValues),
      }),
    [trigger, toStatus, category, action, status, recipients, body],
  );

  return (
    <Modal
      title={editing ? 'Edit automation' : 'Add automation'}
      open={open}
      onCancel={onCancel}
      onOk={() => form.submit()}
      okText={editing ? 'Save' : 'Add automation'}
      confirmLoading={saving}
      destroyOnClose
    >
      <Form form={form} layout="vertical" onFinish={onSubmit} requiredMark={false}>
        <Form.Item
          label="Name"
          name="name"
          rules={[{ required: true, message: 'Give the automation a name' }]}
        >
          <Input placeholder="e.g. Test print goes to quality control" />
        </Form.Item>

        <Form.Item
          label="When"
          name="trigger"
          rules={[{ required: true, message: 'Pick what sets this off' }]}
        >
          <Select
            options={Object.entries(TRIGGER_LABELS).map(([value, label]) => ({ value, label }))}
          />
        </Form.Item>

        {trigger === 'po_status_changed' && (
          <Form.Item
            label="Status reached"
            name="toStatus"
            rules={[{ required: true, message: 'Pick the status it moves into' }]}
          >
            <Select options={STATUS_OPTIONS} />
          </Form.Item>
        )}

        {trigger === 'po_file_uploaded' && (
          <Form.Item
            label="File category"
            name="category"
            extra="Leave empty to run on any file."
          >
            <Select options={CATEGORY_OPTIONS} allowClear placeholder="Any file" />
          </Form.Item>
        )}

        <Form.Item
          label="Then"
          name="action"
          rules={[{ required: true, message: 'Pick what should happen' }]}
        >
          <Select
            options={Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label }))}
          />
        </Form.Item>

        {action === 'set_status' && (
          <Form.Item
            label="Move to"
            name="status"
            rules={[{ required: true, message: 'Pick the status to move to' }]}
            extra="A move the purchase order is not allowed to make is skipped and logged, never forced."
          >
            <Select options={STATUS_OPTIONS} />
          </Form.Item>
        )}

        {action === 'notify' && (
          <Form.Item
            label="Notify"
            name="recipients"
            rules={[{ required: true, message: 'Pick at least one person to notify' }]}
          >
            <Select mode="multiple" options={RECIPIENT_OPTIONS} placeholder="Nobody" />
          </Form.Item>
        )}

        {action === 'add_note' && (
          <Form.Item
            label="Note"
            name="body"
            rules={[{ required: true, message: 'Write the note this should add' }]}
          >
            <Input.TextArea rows={3} placeholder="e.g. Test print received — checking colours" />
          </Form.Item>
        )}

        <div
          data-testid="automation-preview"
          style={{
            padding: '8px 12px',
            borderRadius: 6,
            border: '1px solid rgba(128,128,128,0.2)',
          }}
        >
          <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
            This rule reads
          </Text>
          <Text>{preview}</Text>
        </div>
      </Form>
    </Modal>
  );
}
