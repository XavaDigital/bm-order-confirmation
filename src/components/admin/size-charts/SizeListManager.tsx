'use client';

/**
 * Ordered size list editor for a size chart: one row per size with a label,
 * a "Tall available" toggle (offers an extra-long "<size> Tall" variant to
 * customers), drag-reorder, and remove. Controlled component.
 */
import { useState } from 'react';
import { Button, Checkbox, Input, Space, Typography } from 'antd';
import { PlusOutlined, CloseOutlined, DragOutlined } from '@ant-design/icons';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { SizeChartSize } from '@/db/schema';

const { Text } = Typography;

interface Props {
  value?: SizeChartSize[];
  onChange?: (value: SizeChartSize[]) => void;
  disabled?: boolean;
}

function SortableRow({
  size,
  disabled,
  onToggleTall,
  onRemove,
}: {
  size: SizeChartSize;
  disabled: boolean;
  onToggleTall: (tall: boolean) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: size.label,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 0',
      }}
      {...attributes}
    >
      <DragOutlined {...listeners} style={{ fontSize: 12, cursor: 'move' }} />
      <Text strong style={{ minWidth: 60 }}>
        {size.label}
      </Text>
      <Checkbox
        checked={size.tall}
        disabled={disabled}
        onChange={(e) => onToggleTall(e.target.checked)}
      >
        Tall available
      </Checkbox>
      <Button
        type="text"
        size="small"
        danger
        icon={<CloseOutlined style={{ fontSize: 10 }} />}
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Remove ${size.label}`}
      />
    </div>
  );
}

export function SizeListManager({ value = [], onChange, disabled = false }: Props) {
  const [newLabel, setNewLabel] = useState('');

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function addSize() {
    const label = newLabel.trim();
    if (!label) return;
    if (value.some((s) => s.label.toLowerCase() === label.toLowerCase())) {
      setNewLabel('');
      return;
    }
    onChange?.([...value, { label, tall: false }]);
    setNewLabel('');
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = value.findIndex((s) => s.label === active.id);
    const newIndex = value.findIndex((s) => s.label === over.id);
    onChange?.(arrayMove(value, oldIndex, newIndex));
  }

  return (
    <div>
      {value.length > 0 ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={value.map((s) => s.label)} strategy={verticalListSortingStrategy}>
            <div style={{ marginBottom: 8 }}>
              {value.map((size, i) => (
                <SortableRow
                  key={size.label}
                  size={size}
                  disabled={disabled}
                  onToggleTall={(tall) =>
                    onChange?.(value.map((s, j) => (j === i ? { ...s, tall } : s)))
                  }
                  onRemove={() => onChange?.(value.filter((_, j) => j !== i))}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
          No sizes yet — sizes listed here become the selectable options for garments linked to
          this chart.
        </Text>
      )}

      <Space.Compact style={{ width: '100%' }}>
        <Input
          size="small"
          placeholder="Add size (e.g. XS, S, M, L)"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onPressEnter={(e) => {
            e.preventDefault();
            addSize();
          }}
          disabled={disabled}
        />
        <Button size="small" icon={<PlusOutlined />} onClick={addSize} disabled={disabled || !newLabel.trim()}>
          Add
        </Button>
      </Space.Compact>
    </div>
  );
}
