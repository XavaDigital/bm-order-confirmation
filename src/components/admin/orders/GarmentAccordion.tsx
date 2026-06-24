'use client';

import { useState } from 'react';
import {
  Collapse,
  Form,
  Input,
  Select,
  Button,
  Space,
  message,
  Popconfirm,
  Typography,
  Divider,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  SaveOutlined,
  AppstoreOutlined,
} from '@ant-design/icons';
import { SizingTable } from './SizingTable';
import { MockupUploader, type MockupImage } from './MockupUploader';
import { SizeChartLinker } from './SizeChartLinker';

interface SizingRow {
  id?: string;
  size?: string | null;
  playerName?: string | null;
  playerNumber?: string | null;
  notes?: string | null;
  sortOrder?: number;
}

interface Garment {
  id: string;
  name: string;
  fabrics: string[];
  notes: string | null;
  sortOrder: number;
  sizing: SizingRow[];
  images: MockupImage[];
  sizeChartIds: string[];
}

interface Props {
  orderId: string;
  initialGarments: Garment[];
}

export function GarmentAccordion({ orderId, initialGarments }: Props) {
  const [garments, setGarments] = useState<Garment[]>(initialGarments);
  const [addingName, setAddingName] = useState('');
  const [addingLoading, setAddingLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [localEdits, setLocalEdits] = useState<Record<string, Partial<Garment>>>({});

  function getEdit<K extends keyof Garment>(garment: Garment, key: K): Garment[K] {
    return (localEdits[garment.id]?.[key] ?? garment[key]) as Garment[K];
  }

  function setEdit(garmentId: string, patch: Partial<Garment>) {
    setLocalEdits((prev) => ({
      ...prev,
      [garmentId]: { ...(prev[garmentId] ?? {}), ...patch },
    }));
  }

  async function saveGarment(garment: Garment) {
    const edits = localEdits[garment.id] ?? {};
    if (Object.keys(edits).length === 0) return;

    setSavingId(garment.id);
    try {
      const res = await fetch(
        `/api/admin/orders/${orderId}/garments/${garment.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: edits.name ?? garment.name,
            fabrics: edits.fabrics ?? garment.fabrics,
            notes: edits.notes !== undefined ? edits.notes : garment.notes,
          }),
        },
      );
      if (!res.ok) throw new Error('Save failed');

      setGarments((prev) =>
        prev.map((g) =>
          g.id === garment.id ? { ...g, ...edits } : g,
        ),
      );
      setLocalEdits((prev) => {
        const next = { ...prev };
        delete next[garment.id];
        return next;
      });
      message.success('Garment saved');
    } catch {
      message.error('Failed to save garment');
    } finally {
      setSavingId(null);
    }
  }

  async function deleteGarment(garmentId: string) {
    try {
      const res = await fetch(
        `/api/admin/orders/${orderId}/garments/${garmentId}`,
        { method: 'DELETE' },
      );
      if (!res.ok) throw new Error('Delete failed');
      setGarments((prev) => prev.filter((g) => g.id !== garmentId));
      message.success('Garment removed');
    } catch {
      message.error('Failed to remove garment');
    }
  }

  async function addGarment() {
    if (!addingName.trim()) {
      message.warning('Enter a garment name');
      return;
    }
    setAddingLoading(true);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/garments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: addingName.trim() }),
      });
      if (!res.ok) throw new Error('Failed to add garment');
      const garment = await res.json();
      setGarments((prev) => [...prev, { ...garment, fabrics: garment.fabrics ?? [], sizing: [], images: [], sizeChartIds: [] }]);
      setAddingName('');
      message.success('Garment added');
    } catch {
      message.error('Failed to add garment');
    } finally {
      setAddingLoading(false);
    }
  }

  const collapseItems = garments.map((garment) => {
    const hasEdits = Object.keys(localEdits[garment.id] ?? {}).length > 0;
    const currentName = getEdit(garment, 'name');
    const currentFabrics = getEdit(garment, 'fabrics');
    const currentNotes = getEdit(garment, 'notes');

    return {
      key: garment.id,
      label: (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <AppstoreOutlined />
          <span style={{ fontWeight: 600 }}>{currentName}</span>
          {hasEdits && (
            <Typography.Text type="warning" style={{ fontSize: 12 }}>
              (unsaved)
            </Typography.Text>
          )}
        </div>
      ),
      children: (
        <Space direction="vertical" style={{ width: '100%' }} size={16}>
          {/* Garment name + core fields */}
          <Form layout="vertical" size="small">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
              <Form.Item label="Garment Name">
                <Input
                  value={currentName}
                  onChange={(e) => setEdit(garment.id, { name: e.target.value })}
                />
              </Form.Item>
              <Form.Item label="Fabrics">
                <Select
                  mode="tags"
                  value={Array.isArray(currentFabrics) ? currentFabrics : []}
                  onChange={(val: string[]) => setEdit(garment.id, { fabrics: val })}
                  placeholder="Type and press Enter"
                  tokenSeparators={[',']}
                  open={false}
                  suffixIcon={null}
                />
              </Form.Item>
            </div>
            <Form.Item label="Notes">
              <Input.TextArea
                rows={2}
                value={currentNotes ?? ''}
                onChange={(e) => setEdit(garment.id, { notes: e.target.value || null })}
                placeholder="Garment-level notes (e.g. Chinese collar, sublimated)"
              />
            </Form.Item>
          </Form>

          {hasEdits && (
            <Space>
              <Button
                type="primary"
                size="small"
                icon={<SaveOutlined />}
                loading={savingId === garment.id}
                onClick={() => saveGarment(garment)}
              >
                Save changes
              </Button>
              <Button
                size="small"
                onClick={() =>
                  setLocalEdits((prev) => {
                    const next = { ...prev };
                    delete next[garment.id];
                    return next;
                  })
                }
              >
                Discard
              </Button>
            </Space>
          )}

          <Divider style={{ margin: '4px 0' }} />

          <div>
            <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
              Mock-up Images
            </Typography.Text>
            <MockupUploader
              orderId={orderId}
              garmentId={garment.id}
              initialImages={garment.images}
            />
          </div>

          <Divider style={{ margin: '4px 0' }} />

          <div>
            <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
              Sizing
            </Typography.Text>
            <SizingTable
              orderId={orderId}
              garmentId={garment.id}
              initialRows={garment.sizing}
            />
          </div>

          <Divider style={{ margin: '4px 0' }} />

          <div>
            <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
              Reference Size Charts
            </Typography.Text>
            <SizeChartLinker
              orderId={orderId}
              garmentId={garment.id}
              initialIds={garment.sizeChartIds}
            />
          </div>

          <Divider style={{ margin: '4px 0' }} />

          <Popconfirm
            title="Delete this garment?"
            description="All sizing rows and images for this garment will also be removed."
            onConfirm={() => deleteGarment(garment.id)}
            okText="Delete"
            okType="danger"
          >
            <Button danger size="small" icon={<DeleteOutlined />}>
              Delete garment
            </Button>
          </Popconfirm>
        </Space>
      ),
    };
  });

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      {garments.length === 0 && (
        <Typography.Text type="secondary">No garments added yet.</Typography.Text>
      )}

      {garments.length > 0 && (
        <Collapse
          items={collapseItems}
          defaultActiveKey={garments.length === 1 ? [garments[0].id] : []}
        />
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Input
          placeholder="New garment name (e.g. Home Jersey)"
          value={addingName}
          onChange={(e) => setAddingName(e.target.value)}
          onPressEnter={addGarment}
          style={{ maxWidth: 320 }}
          size="small"
        />
        <Button
          size="small"
          icon={<PlusOutlined />}
          loading={addingLoading}
          onClick={addGarment}
        >
          Add garment
        </Button>
      </div>
    </Space>
  );
}
