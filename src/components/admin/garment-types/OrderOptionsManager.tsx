'use client';

/**
 * Manages a garment type's configurable options — ported from Sales Hub's
 * product OrderOptionsManager (bm-sales client/src/components/product/) and
 * extended with a free-text variant, a checkbox variant, and chained
 * conditional visibility (`showWhen`) — see CHAINED_CONDITIONAL_FIELDS_PLAN.md.
 * Each option is either a constrained pick-list (`select`), a free-text
 * field (`text`), or a checkbox (`checkbox`), optionally shown only when a
 * PRECEDING option in the list matches a value.
 */
import { useState, useEffect } from 'react';
import {
  Button,
  Table,
  Modal,
  Form,
  Input,
  Select,
  Space,
  Typography,
  Popconfirm,
  Radio,
  Checkbox,
  Tag,
  App,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import type { GarmentTypeOption } from '@/db/schema';

const { Text } = Typography;

interface Props {
  value?: GarmentTypeOption[];
  onChange?: (options: GarmentTypeOption[]) => void;
  disabled?: boolean;
}

interface OptionFormValues {
  label: string;
  type: 'select' | 'text' | 'checkbox';
  defaultOption?: string;
  defaultValue?: string;
  defaultChecked?: boolean;
  showWhenParentLabel?: string;
  showWhenChecked?: 'true' | 'false';
  showWhenValues?: string[];
}

/** Human-readable summary of a condition, e.g. "Shown if Numbers? = Checked". */
function describeCondition(opt: GarmentTypeOption, allOptions: GarmentTypeOption[]): string | null {
  if (!opt.showWhen) return null;
  const parent = allOptions.find((o) => o.label === opt.showWhen!.parentLabel);
  const values =
    parent?.type === 'checkbox'
      ? opt.showWhen.equals.map((v) => (v === 'true' ? 'Checked' : 'Unchecked'))
      : opt.showWhen.equals;
  return `Shown if ${opt.showWhen.parentLabel} = ${values.join(', ')}`;
}

export function OrderOptionsManager({ value = [], onChange, disabled = false }: Props) {
  const { message } = App.useApp();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number>(-1);
  const [form] = Form.useForm<OptionFormValues>();
  const [optionValues, setOptionValues] = useState<string[]>([]);
  const [newOptionValue, setNewOptionValue] = useState('');
  const optionType = Form.useWatch('type', form) ?? 'select';
  const showWhenParentLabel = Form.useWatch('showWhenParentLabel', form);

  const editing = editingIndex >= 0 ? value[editingIndex] : null;

  // Only an option already ABOVE this one in the list can be a parent — that
  // is the acyclic guarantee the server also enforces (by index), and it's
  // why a new option (appended at the end) can gate on any existing one
  // while an option being edited can only see options before its own index.
  const eligibleParents = (editingIndex >= 0 ? value.slice(0, editingIndex) : value).filter(
    (o) => o.type === 'select' || o.type === 'checkbox',
  );
  const showWhenParent = eligibleParents.find((o) => o.label === showWhenParentLabel) ?? null;

  useEffect(() => {
    if (!modalOpen) return;
    if (editing) {
      // If the parent this option was gated on is no longer eligible (e.g.
      // deleted since), drop the condition rather than seed a dangling ref.
      const parentStillEligible = editing.showWhen
        ? eligibleParents.some((o) => o.label === editing.showWhen!.parentLabel)
        : false;
      const parent = editing.showWhen
        ? eligibleParents.find((o) => o.label === editing.showWhen!.parentLabel)
        : null;
      form.setFieldsValue({
        label: editing.label,
        type: editing.type,
        defaultOption: editing.type === 'select' ? editing.defaultOption : undefined,
        defaultValue: editing.type === 'text' ? editing.defaultValue : undefined,
        defaultChecked: editing.type === 'checkbox' ? (editing.defaultValue ?? false) : undefined,
        showWhenParentLabel: parentStillEligible ? editing.showWhen!.parentLabel : undefined,
        showWhenChecked:
          parentStillEligible && parent?.type === 'checkbox'
            ? (editing.showWhen!.equals[0] as 'true' | 'false')
            : undefined,
        showWhenValues:
          parentStillEligible && parent?.type === 'select' ? editing.showWhen!.equals : undefined,
      });
      setOptionValues(editing.type === 'select' ? [...editing.options] : []);
    } else {
      form.resetFields();
      form.setFieldValue('type', 'select');
      setOptionValues([]);
    }
    setNewOptionValue('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalOpen, editing, form]);

  function openAdd() {
    setEditingIndex(-1);
    setModalOpen(true);
  }

  function openEdit(index: number) {
    setEditingIndex(index);
    setModalOpen(true);
  }

  function deleteOption(index: number) {
    const removedLabel = value[index].label;
    // Deleting a parent must not leave a dangling showWhen on its children.
    onChange?.(
      value
        .filter((_, i) => i !== index)
        .map((o) => (o.showWhen?.parentLabel === removedLabel ? { ...o, showWhen: undefined } : o)),
    );
  }

  function addOptionValue() {
    const v = newOptionValue.trim();
    if (!v) return;
    if (optionValues.includes(v)) {
      message.warning('This option value already exists');
      return;
    }
    setOptionValues([...optionValues, v]);
    setNewOptionValue('');
  }

  function removeOptionValue(valueToRemove: string) {
    setOptionValues(optionValues.filter((v) => v !== valueToRemove));
    if (form.getFieldValue('defaultOption') === valueToRemove) {
      form.setFieldValue('defaultOption', undefined);
    }
  }

  async function saveOption() {
    let values: OptionFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    let showWhen: GarmentTypeOption['showWhen'];
    if (values.showWhenParentLabel) {
      const parent = eligibleParents.find((o) => o.label === values.showWhenParentLabel);
      if (parent?.type === 'checkbox') {
        if (!values.showWhenChecked) {
          message.error('Pick Checked or Unchecked for the condition');
          return;
        }
        showWhen = { parentLabel: values.showWhenParentLabel, equals: [values.showWhenChecked] };
      } else {
        if (!values.showWhenValues || values.showWhenValues.length === 0) {
          message.error('Pick at least one value for the condition');
          return;
        }
        showWhen = { parentLabel: values.showWhenParentLabel, equals: values.showWhenValues };
      }
    }

    let option: GarmentTypeOption;
    if (values.type === 'text') {
      option = {
        label: values.label.trim(),
        type: 'text',
        ...(values.defaultValue?.trim() && { defaultValue: values.defaultValue.trim() }),
        ...(showWhen && { showWhen }),
      };
    } else if (values.type === 'checkbox') {
      option = {
        label: values.label.trim(),
        type: 'checkbox',
        ...(values.defaultChecked && { defaultValue: true }),
        ...(showWhen && { showWhen }),
      };
    } else {
      if (optionValues.length === 0) {
        message.error('Add at least one option value');
        return;
      }
      if (values.defaultOption && !optionValues.includes(values.defaultOption)) {
        message.error('Default must be one of the listed values');
        return;
      }
      option = {
        label: values.label.trim(),
        type: 'select',
        options: [...optionValues],
        ...(values.defaultOption && { defaultOption: values.defaultOption }),
        ...(showWhen && { showWhen }),
      };
    }

    const duplicate = value.some(
      (o, i) => i !== editingIndex && o.label.toLowerCase() === option.label.toLowerCase(),
    );
    if (duplicate) {
      message.error('An option with this label already exists');
      return;
    }

    const next = editingIndex >= 0
      ? value.map((o, i) => (i === editingIndex ? option : o))
      : [...value, option];
    onChange?.(next);
    setModalOpen(false);
    setEditingIndex(-1);
  }

  const columns = [
    {
      title: 'Label',
      dataIndex: 'label',
      key: 'label',
      render: (text: string) => <Text strong>{text}</Text>,
    },
    {
      title: 'Values',
      key: 'values',
      render: (_: unknown, record: GarmentTypeOption) =>
        record.type === 'text' ? (
          <Tag>Free text</Tag>
        ) : record.type === 'checkbox' ? (
          <Tag>Checkbox</Tag>
        ) : (
          <Space wrap>
            {record.options.map((option) => (
              <Tag key={option} color="blue">
                {option}
              </Tag>
            ))}
          </Space>
        ),
    },
    {
      title: 'Default',
      key: 'default',
      render: (_: unknown, record: GarmentTypeOption) => {
        const def =
          record.type === 'select'
            ? record.defaultOption
            : record.type === 'checkbox'
              ? (record.defaultValue ? 'Checked' : undefined)
              : record.defaultValue;
        return def ? <Tag color="green">{def}</Tag> : <Text type="secondary">—</Text>;
      },
    },
    {
      title: 'Condition',
      key: 'condition',
      render: (_: unknown, record: GarmentTypeOption) => {
        const desc = describeCondition(record, value);
        return desc ? <Tag color="purple">{desc}</Tag> : <Text type="secondary">—</Text>;
      },
    },
    {
      title: '',
      key: 'actions',
      width: 90,
      render: (_: unknown, record: GarmentTypeOption, index: number) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => openEdit(index)}
            disabled={disabled}
            title="Edit option"
          />
          <Popconfirm title="Delete this option?" onConfirm={() => deleteOption(index)} okText="Delete" okType="danger">
            <Button type="link" size="small" danger icon={<DeleteOutlined />} disabled={disabled} title="Delete option" />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      {value.length > 0 ? (
        <Table
          columns={columns}
          dataSource={value}
          pagination={false}
          size="small"
          rowKey={(record) => record.label}
          style={{ marginBottom: 12 }}
        />
      ) : (
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          No options yet — options like “Zip Type” or “Cord Color” become pickers when staff add
          this garment to an order.
        </Text>
      )}
      <Button type="dashed" icon={<PlusOutlined />} onClick={openAdd} disabled={disabled} block>
        Add option
      </Button>

      <Modal
        title={editing ? 'Edit Option' : 'Add Option'}
        open={modalOpen}
        onOk={saveOption}
        onCancel={() => {
          setModalOpen(false);
          setEditingIndex(-1);
        }}
        width={560}
        okText={editing ? 'Update' : 'Add'}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            label="Option label"
            name="label"
            rules={[{ required: true, message: 'Enter an option label' }]}
            help="e.g. 'Hood Lining Fabric', 'Zip Type', 'Cord Color'"
          >
            <Input placeholder="Enter option label" />
          </Form.Item>

          <Form.Item label="Answer type" name="type" initialValue="select">
            <Radio.Group
              options={[
                { label: 'Pick from preset values', value: 'select' },
                { label: 'Free text', value: 'text' },
                { label: 'Checkbox', value: 'checkbox' },
              ]}
            />
          </Form.Item>

          {optionType === 'select' ? (
            <>
              <Form.Item label="Values" required>
                <Space.Compact style={{ width: '100%', marginBottom: 8 }}>
                  <Input
                    placeholder="Enter a value"
                    value={newOptionValue}
                    onChange={(e) => setNewOptionValue(e.target.value)}
                    onPressEnter={(e) => {
                      e.preventDefault();
                      addOptionValue();
                    }}
                  />
                  <Button type="primary" onClick={addOptionValue}>
                    Add
                  </Button>
                </Space.Compact>
                <div style={{ minHeight: 32 }}>
                  <Space wrap>
                    {optionValues.map((v) => (
                      <Tag key={v} closable onClose={() => removeOptionValue(v)} color="blue">
                        {v}
                      </Tag>
                    ))}
                  </Space>
                </div>
                {optionValues.length === 0 && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Add values like “full-zip”, “quarter-zip”, “pullover”.
                  </Text>
                )}
              </Form.Item>

              <Form.Item
                label="Default value"
                name="defaultOption"
                help="Pre-selected when staff add this garment to an order"
              >
                <Select
                  placeholder="Select default (optional)"
                  allowClear
                  options={optionValues.map((v) => ({ value: v, label: v }))}
                />
              </Form.Item>
            </>
          ) : optionType === 'checkbox' ? (
            <Form.Item name="defaultChecked" valuePropName="checked">
              <Checkbox>Checked by default</Checkbox>
            </Form.Item>
          ) : (
            <Form.Item label="Default text" name="defaultValue" help="Optional pre-filled text">
              <Input placeholder="Optional default" />
            </Form.Item>
          )}

          {eligibleParents.length > 0 && (
            <>
              <Form.Item
                label="Show only when"
                name="showWhenParentLabel"
                help="Hides this option unless the chosen option above currently matches"
              >
                <Select
                  allowClear
                  placeholder="Always shown"
                  options={eligibleParents.map((o) => ({ value: o.label, label: o.label }))}
                  onChange={() => {
                    form.setFieldsValue({ showWhenChecked: undefined, showWhenValues: undefined });
                  }}
                />
              </Form.Item>

              {showWhenParent?.type === 'checkbox' && (
                <Form.Item
                  name="showWhenChecked"
                  rules={[{ required: true, message: 'Pick Checked or Unchecked' }]}
                >
                  <Radio.Group
                    options={[
                      { label: 'Checked', value: 'true' },
                      { label: 'Unchecked', value: 'false' },
                    ]}
                  />
                </Form.Item>
              )}

              {showWhenParent?.type === 'select' && (
                <Form.Item
                  name="showWhenValues"
                  rules={[{ required: true, message: 'Pick at least one value' }]}
                >
                  <Select
                    mode="multiple"
                    placeholder={`Select ${showWhenParent.label.toLowerCase()} value(s)`}
                    options={showWhenParent.options.map((o) => ({ value: o, label: o }))}
                  />
                </Form.Item>
              )}
            </>
          )}
        </Form>
      </Modal>
    </>
  );
}
