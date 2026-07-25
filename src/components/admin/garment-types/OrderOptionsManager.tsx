'use client';

/**
 * Manages a garment type's configurable options — ported from Sales Hub's
 * product OrderOptionsManager (bm-sales client/src/components/product/) and
 * extended with a free-text variant: each option is either a constrained
 * pick-list (`select`) or a free-text field (`text`).
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
  type: 'select' | 'text';
  defaultOption?: string;
  defaultValue?: string;
}

export function OrderOptionsManager({ value = [], onChange, disabled = false }: Props) {
  const { message } = App.useApp();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number>(-1);
  const [form] = Form.useForm<OptionFormValues>();
  const [optionValues, setOptionValues] = useState<string[]>([]);
  const [newOptionValue, setNewOptionValue] = useState('');
  const optionType = Form.useWatch('type', form) ?? 'select';

  const editing = editingIndex >= 0 ? value[editingIndex] : null;

  useEffect(() => {
    if (!modalOpen) return;
    if (editing) {
      form.setFieldsValue({
        label: editing.label,
        type: editing.type,
        defaultOption: editing.type === 'select' ? editing.defaultOption : undefined,
        defaultValue: editing.type === 'text' ? editing.defaultValue : undefined,
      });
      setOptionValues(editing.type === 'select' ? [...editing.options] : []);
    } else {
      form.resetFields();
      form.setFieldValue('type', 'select');
      setOptionValues([]);
    }
    setNewOptionValue('');
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
    onChange?.(value.filter((_, i) => i !== index));
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

    let option: GarmentTypeOption;
    if (values.type === 'text') {
      option = {
        label: values.label.trim(),
        type: 'text',
        ...(values.defaultValue?.trim() && { defaultValue: values.defaultValue.trim() }),
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
        const def = record.type === 'select' ? record.defaultOption : record.defaultValue;
        return def ? <Tag color="green">{def}</Tag> : <Text type="secondary">—</Text>;
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
          ) : (
            <Form.Item label="Default text" name="defaultValue" help="Optional pre-filled text">
              <Input placeholder="Optional default" />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </>
  );
}
