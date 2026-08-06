'use client';

/**
 * Pre-send checklist settings (David, 2026-08-06) — the checks production works
 * through before a purchase order may go to a supplier.
 *
 * The checks were config from the start but had no screen: the two seeded items
 * existed only because a migration put them there, so nobody could add the third
 * one. This is that screen. Same species of configuration as the board stages
 * next door, so it lives on the same page.
 *
 * Two things are deliberately NOT editable here:
 *  - the auto-rule vocabulary — each rule has an evaluator in code, so adding a
 *    RULE is a deploy while adding a CHECK is a setting;
 *  - deletion — a check that has been ticked or sidestepped is referenced by
 *    that record, so retiring is the only removal.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  App,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { ApiError, getJson, patchJson, postJson } from '@/lib/api-fetch';

const { Text } = Typography;

export type PoChecklistAutoRule = 'design_file_attached' | 'color_book_set';

export interface PoChecklistItemRow {
  id: string;
  label: string;
  autoRule: PoChecklistAutoRule | null;
  allowSidestep: boolean;
  sortOrder: number;
  isActive: boolean;
}

const ITEMS_URL = '/api/admin/purchase-orders/checklist-items';

/** Plain-language names for the rules a check can satisfy itself with. */
const AUTO_RULE_LABELS: Record<PoChecklistAutoRule, string> = {
  design_file_attached: 'A design file is attached',
  color_book_set: 'A colour book is chosen',
};

interface FormValues {
  label: string;
  autoRule: PoChecklistAutoRule | 'manual';
  allowSidestep: boolean;
  sortOrder: number;
}

export function PoChecklistSettings({ canMutate }: { canMutate: boolean }) {
  const { message } = App.useApp();
  const [items, setItems] = useState<PoChecklistItemRow[] | null>(null);
  const [editing, setEditing] = useState<PoChecklistItemRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingRowId, setSavingRowId] = useState<string | null>(null);
  const [form] = Form.useForm<FormValues>();

  const load = useCallback(async () => {
    try {
      const data = await getJson<{ items: PoChecklistItemRow[] }>(
        ITEMS_URL,
        'Failed to load the checklist',
      );
      setItems(data.items);
    } catch (err) {
      setItems([]);
      message.error(err instanceof Error ? err.message : 'Failed to load the checklist');
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  /** One-field row toggles (sidesteppable, in use) — no modal for a switch. */
  async function patchItem(item: PoChecklistItemRow, patch: Partial<PoChecklistItemRow>) {
    setSavingRowId(item.id);
    try {
      const data = await patchJson<{ item: PoChecklistItemRow }>(
        `${ITEMS_URL}/${item.id}`,
        patch,
        'Failed to save the check',
      );
      setItems((rows) => (rows ?? []).map((r) => (r.id === item.id ? data.item : r)));
    } catch (err) {
      message.error(
        err instanceof ApiError || err instanceof Error ? err.message : 'Failed to save the check',
      );
    } finally {
      setSavingRowId(null);
    }
  }

  function openCreate() {
    const nextOrder = Math.max(0, ...(items ?? []).map((i) => i.sortOrder)) + 1;
    form.setFieldsValue({
      label: '',
      autoRule: 'manual',
      allowSidestep: false,
      sortOrder: nextOrder,
    });
    setCreating(true);
  }

  function openEdit(item: PoChecklistItemRow) {
    form.setFieldsValue({
      label: item.label,
      autoRule: item.autoRule ?? 'manual',
      allowSidestep: item.allowSidestep,
      sortOrder: item.sortOrder,
    });
    setEditing(item);
  }

  async function submit(values: FormValues) {
    const payload = {
      label: values.label,
      autoRule: values.autoRule === 'manual' ? null : values.autoRule,
      allowSidestep: values.allowSidestep ?? false,
      sortOrder: values.sortOrder,
    };
    setSaving(true);
    try {
      if (editing) {
        await patchJson(`${ITEMS_URL}/${editing.id}`, payload, 'Failed to save the check');
        message.success('Check saved');
      } else {
        await postJson(ITEMS_URL, payload, 'Failed to add the check');
        message.success('Check added');
      }
      setEditing(null);
      setCreating(false);
      await load();
    } catch (err) {
      message.error(
        err instanceof ApiError || err instanceof Error ? err.message : 'Failed to save the check',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card
      size="small"
      title="Pre-send checks"
      extra={
        canMutate && (
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            Add check
          </Button>
        )
      }
    >
      <Typography.Paragraph type="secondary">
        A purchase order cannot be sent to a supplier until every check below is done. Checks
        marked <strong>can be sidestepped</strong> may instead be acknowledged with a reason —
        recorded against the person who gave it. The rest have to be done.
      </Typography.Paragraph>

      <Table<PoChecklistItemRow>
        rowKey="id"
        size="small"
        pagination={false}
        loading={items === null}
        dataSource={items ?? []}
        columns={[
          {
            title: 'Order',
            dataIndex: 'sortOrder',
            width: 80,
          },
          {
            title: 'Check',
            dataIndex: 'label',
            render: (label: string, row) => (
              <span style={{ opacity: row.isActive ? 1 : 0.55 }}>
                <Text strong={row.isActive}>{label}</Text>
                {!row.isActive && <Tag style={{ marginInlineStart: 8 }}>retired</Tag>}
              </span>
            ),
          },
          {
            title: 'Satisfied by',
            dataIndex: 'autoRule',
            width: 220,
            render: (rule: PoChecklistAutoRule | null) =>
              rule ? (
                <Tag color="blue">{AUTO_RULE_LABELS[rule] ?? rule}</Tag>
              ) : (
                <Text type="secondary">Manual</Text>
              ),
          },
          {
            title: (
              <Tooltip title="A sidestep is an acknowledgement with a stated reason — not a silent skip">
                <span>Can be sidestepped</span>
              </Tooltip>
            ),
            dataIndex: 'allowSidestep',
            width: 170,
            render: (allowSidestep: boolean, row) => (
              <Switch
                checked={allowSidestep}
                disabled={!canMutate}
                loading={savingRowId === row.id}
                aria-label={`Can be sidestepped: ${row.label}`}
                onChange={(checked) => void patchItem(row, { allowSidestep: checked })}
              />
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
                aria-label={`In use: ${row.label}`}
                onChange={(checked) => void patchItem(row, { isActive: checked })}
              />
            ),
          },
          ...(canMutate
            ? [
                {
                  title: '',
                  key: 'actions',
                  width: 80,
                  render: (_: unknown, row: PoChecklistItemRow) => (
                    <Button size="small" onClick={() => openEdit(row)}>
                      Edit
                    </Button>
                  ),
                },
              ]
            : []),
        ]}
      />

      <Modal
        title={editing ? 'Edit check' : 'Add check'}
        open={creating || editing !== null}
        onCancel={() => {
          setCreating(false);
          setEditing(null);
        }}
        onOk={() => form.submit()}
        okText={editing ? 'Save' : 'Add check'}
        confirmLoading={saving}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={submit} requiredMark={false}>
          <Form.Item
            label="Check"
            name="label"
            rules={[{ required: true, message: 'Say what has to be checked' }]}
          >
            <Input placeholder="e.g. Checked whether any fonts need to be uploaded" />
          </Form.Item>

          <Form.Item
            label="Satisfied by"
            name="autoRule"
            extra="An automatic check ticks itself from the purchase order's data — nobody has to."
          >
            <Select
              options={[
                { value: 'manual', label: 'Manual — someone ticks it' },
                ...Object.entries(AUTO_RULE_LABELS).map(([value, label]) => ({
                  value,
                  label: `Automatic — ${label.toLowerCase()}`,
                })),
              ]}
            />
          </Form.Item>

          <Form.Item
            label="Can be sidestepped"
            name="allowSidestep"
            valuePropName="checked"
            extra="Off means it has to be done: no acknowledgement will satisfy it."
          >
            <Switch />
          </Form.Item>

          <Form.Item label="Order" name="sortOrder">
            <InputNumber min={0} max={9999} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
