'use client';

/**
 * Manages a garment type's labeled fabric fields — each field is a named
 * fabric slot (e.g. "Outer Fabric", "Hood Lining") with its own pick-list;
 * staff pick ONE fabric per field when building an order garment.
 * Controlled component.
 */
import { Button, Card, Input, Popconfirm, Select, Typography } from 'antd';
import { PlusOutlined, DeleteOutlined, UpOutlined, DownOutlined } from '@ant-design/icons';
import type { GarmentTypeFabricField } from '@/db/schema';

const { Text } = Typography;

interface Props {
  value?: GarmentTypeFabricField[];
  onChange?: (value: GarmentTypeFabricField[]) => void;
  disabled?: boolean;
}

export function FabricFieldsManager({ value = [], onChange, disabled = false }: Props) {
  function update(index: number, patch: Partial<GarmentTypeFabricField>) {
    onChange?.(value.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= value.length) return;
    const next = [...value];
    [next[index], next[target]] = [next[target], next[index]];
    onChange?.(next);
  }

  return (
    <div>
      {value.length === 0 && (
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          No fabric fields yet — each field becomes a required fabric pick when staff add this
          garment to an order (e.g. “Outer Fabric”, “Hood Lining”).
        </Text>
      )}

      {value.map((field, index) => (
        <Card
          key={index}
          size="small"
          style={{ marginBottom: 12 }}
          title={
            <Input
              size="small"
              value={field.label}
              onChange={(e) => update(index, { label: e.target.value })}
              placeholder="Field label (e.g. Outer Fabric)"
              disabled={disabled}
              style={{ maxWidth: 260 }}
            />
          }
          extra={
            <span>
              <Button
                type="text"
                size="small"
                icon={<UpOutlined />}
                onClick={() => move(index, -1)}
                disabled={disabled || index === 0}
                aria-label="Move up"
              />
              <Button
                type="text"
                size="small"
                icon={<DownOutlined />}
                onClick={() => move(index, 1)}
                disabled={disabled || index === value.length - 1}
                aria-label="Move down"
              />
              <Popconfirm
                title="Remove this fabric field?"
                onConfirm={() => onChange?.(value.filter((_, i) => i !== index))}
                okText="Remove"
                okType="danger"
              >
                <Button type="text" size="small" danger icon={<DeleteOutlined />} disabled={disabled} aria-label="Remove field" />
              </Popconfirm>
            </span>
          }
        >
          <Select
            mode="tags"
            value={field.options}
            onChange={(options: string[]) => update(index, { options })}
            placeholder="Type a fabric and press Enter"
            tokenSeparators={[',']}
            open={false}
            suffixIcon={null}
            disabled={disabled}
            style={{ width: '100%' }}
          />
        </Card>
      ))}

      <Button
        type="dashed"
        icon={<PlusOutlined />}
        onClick={() => onChange?.([...value, { label: '', options: [] }])}
        disabled={disabled}
        block
      >
        Add fabric field
      </Button>
    </div>
  );
}
