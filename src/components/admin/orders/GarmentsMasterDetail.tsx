'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Form,
  Input,
  Select,
  Button,
  Space,
  App,
  Popconfirm,
  Typography,
  Divider,
  Grid,
  Menu,
  Empty,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  SaveOutlined,
  AppstoreOutlined,
} from '@ant-design/icons';
import type { GarmentTypeOption, GarmentTypeFabricField, SizeChartSize } from '@/db/schema';
import { SizingTable } from './SizingTable';
import { MockupUploader, type MockupImage } from './MockupUploader';
import { SizeChartLinker } from './SizeChartLinker';
import { postJson, patchJson, deleteJson, getJson } from '@/lib/api-fetch';
import { unionChartSizes } from '@/lib/sizes';

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
  garmentTypeId?: string | null;
  selectedOptions?: Record<string, string> | null;
  selectedFabrics?: Record<string, string> | null;
}

interface GarmentType {
  id: string;
  name: string;
  category: string | null;
  fabricFields: GarmentTypeFabricField[];
  orderOptions: GarmentTypeOption[];
  sizeChartIds: string[];
  isActive: boolean;
}

interface SizeChart {
  id: string;
  name: string;
  description: string | null;
  sizes: SizeChartSize[];
}

/** Default option values for a type ({label: default}), for pre-filling on type selection. */
function typeOptionDefaults(type: GarmentType): Record<string, string> {
  const defaults: Record<string, string> = {};
  for (const opt of type.orderOptions) {
    if (opt.type === 'select' && opt.defaultOption) defaults[opt.label] = opt.defaultOption;
    if (opt.type === 'text' && opt.defaultValue) defaults[opt.label] = opt.defaultValue;
  }
  return defaults;
}

interface Props {
  orderId: string;
  initialGarments: Garment[];
  /**
   * Called after any change that can alter purchase-order coverage (garment
   * added/edited/removed, sizing saved) so the order view can refresh its
   * production indicators without a page reload.
   */
  onGarmentsChanged?: () => void;
}

/**
 * Master-detail garments editor: a garment list column on the left, the
 * selected garment's full editor on the right. Replaces the old accordion —
 * with several garments open the accordion got unwieldy; here exactly one
 * garment is in view at a time.
 */
export function GarmentsMasterDetail({ orderId, initialGarments, onGarmentsChanged }: Props) {
  const { message } = App.useApp();
  const searchParams = useSearchParams();
  const screens = Grid.useBreakpoint();
  const isNarrow = screens.lg === false;

  const [garments, setGarments] = useState<Garment[]>(initialGarments);
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const fromUrl = searchParams.get('garment');
    if (fromUrl && initialGarments.some((g) => g.id === fromUrl)) return fromUrl;
    return initialGarments[0]?.id ?? null;
  });
  const [addingName, setAddingName] = useState('');
  const [addingLoading, setAddingLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [localEdits, setLocalEdits] = useState<Record<string, Partial<Garment>>>({});
  const [types, setTypes] = useState<GarmentType[]>([]);
  const [charts, setCharts] = useState<SizeChart[]>([]);
  const [applyingCharts, setApplyingCharts] = useState(false);

  useEffect(() => {
    // Both are enhancements — the free-text flow still works without them.
    getJson<GarmentType[]>('/api/admin/garment-types', 'Failed to load garment types')
      .then(setTypes)
      .catch(() => {});
    getJson<SizeChart[]>('/api/admin/size-charts', 'Failed to load size charts')
      .then(setCharts)
      .catch(() => {});
  }, []);

  const selected = garments.find((g) => g.id === selectedId) ?? null;

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
      await patchJson(
        `/api/admin/orders/${orderId}/garments/${garment.id}`,
        {
          name: edits.name ?? garment.name,
          fabrics: edits.fabrics ?? garment.fabrics,
          notes: edits.notes !== undefined ? edits.notes : garment.notes,
          ...(edits.garmentTypeId !== undefined && { garmentTypeId: edits.garmentTypeId }),
          ...(edits.selectedOptions !== undefined && { selectedOptions: edits.selectedOptions }),
          ...(edits.selectedFabrics !== undefined && { selectedFabrics: edits.selectedFabrics }),
        },
        'Save failed',
      );

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
      onGarmentsChanged?.();
    } catch {
      message.error('Failed to save garment');
    } finally {
      setSavingId(null);
    }
  }

  async function deleteGarment(garmentId: string) {
    setDeletingId(garmentId);
    try {
      await deleteJson(`/api/admin/orders/${orderId}/garments/${garmentId}`, undefined, 'Delete failed');
      setGarments((prev) => {
        const next = prev.filter((g) => g.id !== garmentId);
        if (selectedId === garmentId) setSelectedId(next[0]?.id ?? null);
        return next;
      });
      message.success('Garment removed');
      onGarmentsChanged?.();
    } catch {
      message.error('Failed to remove garment');
    } finally {
      setDeletingId(null);
    }
  }

  async function addGarment() {
    if (!addingName.trim()) {
      message.warning('Enter a garment name');
      return;
    }
    setAddingLoading(true);
    try {
      const garment = await postJson<Pick<Garment, 'id' | 'name' | 'notes' | 'sortOrder'> & { fabrics?: string[]; garmentTypeId?: string | null; selectedOptions?: Record<string, string> | null }>(
        `/api/admin/orders/${orderId}/garments`,
        { name: addingName.trim() },
        'Failed to add garment',
      );
      setGarments((prev) => [
        ...prev,
        {
          ...garment,
          fabrics: garment.fabrics ?? [],
          sizing: [],
          images: [],
          sizeChartIds: [],
          garmentTypeId: garment.garmentTypeId ?? null,
          selectedOptions: garment.selectedOptions ?? null,
        },
      ]);
      setSelectedId(garment.id);
      setAddingName('');
      message.success('Garment added');
      onGarmentsChanged?.();
    } catch {
      message.error('Failed to add garment');
    } finally {
      setAddingLoading(false);
    }
  }

  const addControl = (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <Input
        placeholder="New garment name"
        value={addingName}
        onChange={(e) => setAddingName(e.target.value)}
        onPressEnter={addGarment}
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
  );

  const listItems = garments.map((garment) => {
    const hasEdits = Object.keys(localEdits[garment.id] ?? {}).length > 0;
    const currentName = getEdit(garment, 'name');
    return {
      key: garment.id,
      icon: <AppstoreOutlined />,
      label: (
        <span>
          {currentName}
          {hasEdits && (
            <Typography.Text
              type="warning"
              title="Unsaved changes"
              style={{ fontSize: 12, marginLeft: 6 }}
            >
              •
            </Typography.Text>
          )}
        </span>
      ),
    };
  });

  const detailPane = selected ? (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      {(() => {
        const garment = selected;
        const hasEdits = Object.keys(localEdits[garment.id] ?? {}).length > 0;
        const currentName = getEdit(garment, 'name');
        const currentFabrics = getEdit(garment, 'fabrics');
        const currentNotes = getEdit(garment, 'notes');
        const currentTypeId = getEdit(garment, 'garmentTypeId');
        const currentOptions = getEdit(garment, 'selectedOptions') ?? {};
        const currentSelectedFabrics = getEdit(garment, 'selectedFabrics') ?? {};
        const currentType = types.find((t) => t.id === currentTypeId) ?? null;
        const fabricFields = currentType ? currentType.fabricFields : [];
        const typeChoices = types
          .filter((t) => t.isActive || t.id === currentTypeId)
          .map((t) => ({
            value: t.id,
            label: t.category ? `${t.name} (${t.category})` : t.name,
          }));
        const missingTypeCharts = currentType
          ? currentType.sizeChartIds.filter((id) => !garment.sizeChartIds.includes(id))
          : [];
        // Chart-defined sizes drive the sizing dropdown (union of linked charts)
        const allowedSizes = unionChartSizes(
          charts.filter((c) => garment.sizeChartIds.includes(c.id)),
        );

        function onTypeChange(typeId: string | undefined) {
          const type = types.find((t) => t.id === typeId) ?? null;
          if (!type) {
            setEdit(garment.id, { garmentTypeId: null, selectedOptions: null, selectedFabrics: null });
            return;
          }
          // Pre-fill option defaults, keeping any values already chosen
          setEdit(garment.id, {
            garmentTypeId: type.id,
            selectedOptions: { ...typeOptionDefaults(type), ...currentOptions },
          });
        }

        async function applyTypeCharts() {
          if (!currentType || missingTypeCharts.length === 0) return;
          setApplyingCharts(true);
          try {
            const merged = [...new Set([...garment.sizeChartIds, ...currentType.sizeChartIds])];
            await patchJson(
              `/api/admin/orders/${orderId}/garments/${garment.id}`,
              { sizeChartIds: merged },
              'Failed to link size charts',
            );
            setGarments((prev) =>
              prev.map((g) => (g.id === garment.id ? { ...g, sizeChartIds: merged } : g)),
            );
            message.success("Type's size charts linked");
          } catch {
            message.error('Failed to link size charts');
          } finally {
            setApplyingCharts(false);
          }
        }

        return (
          <>
            <Form layout="vertical" size="small">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                <Form.Item label="Garment Name">
                  <Input
                    value={currentName}
                    onChange={(e) => setEdit(garment.id, { name: e.target.value })}
                  />
                </Form.Item>
                <Form.Item label="Type">
                  <Select
                    value={currentTypeId ?? undefined}
                    onChange={onTypeChange}
                    allowClear
                    placeholder={types.length ? 'Pick a garment type (optional)' : 'No types defined yet'}
                    options={typeChoices}
                    showSearch
                    optionFilterProp="label"
                  />
                </Form.Item>
              </div>
              {fabricFields.length > 0 && (
                <>
                  <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
                    Fabrics
                  </Typography.Text>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                    {fabricFields.map((field) => {
                      const chosen = currentSelectedFabrics[field.label];
                      const options = chosen && !field.options.includes(chosen)
                        ? [...field.options, chosen]
                        : field.options;
                      return (
                        <Form.Item key={field.label} label={field.label}>
                          <Select
                            value={chosen || undefined}
                            onChange={(v) =>
                              setEdit(garment.id, {
                                selectedFabrics: { ...currentSelectedFabrics, [field.label]: v ?? '' },
                              })
                            }
                            allowClear
                            showSearch
                            placeholder={`Select ${field.label.toLowerCase()}`}
                            options={options.map((o) => ({ value: o, label: o }))}
                          />
                        </Form.Item>
                      );
                    })}
                  </div>
                </>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                {fabricFields.length === 0 && (
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
                )}
                <Form.Item label="Notes">
                  <Input.TextArea
                    rows={2}
                    value={currentNotes ?? ''}
                    onChange={(e) => setEdit(garment.id, { notes: e.target.value || null })}
                    placeholder="Garment-level notes (e.g. Chinese collar, sublimated)"
                  />
                </Form.Item>
              </div>
              {currentType && currentType.orderOptions.length > 0 && (
                <>
                  <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
                    Options
                  </Typography.Text>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                    {currentType.orderOptions.map((opt) => (
                      <Form.Item key={opt.label} label={opt.label}>
                        {opt.type === 'select' ? (
                          <Select
                            value={currentOptions[opt.label] || undefined}
                            onChange={(v) =>
                              setEdit(garment.id, {
                                selectedOptions: { ...currentOptions, [opt.label]: v ?? '' },
                              })
                            }
                            allowClear
                            placeholder={`Select ${opt.label.toLowerCase()}`}
                            options={opt.options.map((o) => ({ value: o, label: o }))}
                          />
                        ) : (
                          <Input
                            value={currentOptions[opt.label] ?? ''}
                            onChange={(e) =>
                              setEdit(garment.id, {
                                selectedOptions: { ...currentOptions, [opt.label]: e.target.value },
                              })
                            }
                            placeholder={opt.label}
                          />
                        )}
                      </Form.Item>
                    ))}
                  </div>
                </>
              )}
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
                key={garment.id}
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
                key={garment.id}
                orderId={orderId}
                garmentId={garment.id}
                initialRows={garment.sizing}
                allowedSizes={allowedSizes}
                onSaved={onGarmentsChanged}
              />
            </div>

            <Divider style={{ margin: '4px 0' }} />

            <div>
              <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
                Reference Size Charts
              </Typography.Text>
              <SizeChartLinker
                key={garment.id}
                orderId={orderId}
                garmentId={garment.id}
                value={garment.sizeChartIds}
                charts={charts}
                onSaved={(ids) =>
                  setGarments((prev) =>
                    prev.map((g) => (g.id === garment.id ? { ...g, sizeChartIds: ids } : g)),
                  )
                }
              />
              {missingTypeCharts.length > 0 && (
                <Button
                  size="small"
                  type="link"
                  loading={applyingCharts}
                  onClick={applyTypeCharts}
                  style={{ paddingLeft: 0, marginTop: 4 }}
                >
                  Link {currentType!.name}&apos;s {missingTypeCharts.length} size chart
                  {missingTypeCharts.length > 1 ? 's' : ''}
                </Button>
              )}
            </div>

            <Divider style={{ margin: '4px 0' }} />

            <Popconfirm
              title="Delete this garment?"
              description="All sizing rows and images for this garment will also be removed."
              onConfirm={() => deleteGarment(garment.id)}
              okText="Delete"
              okType="danger"
              disabled={deletingId !== null}
            >
              <Button
                danger
                size="small"
                icon={<DeleteOutlined />}
                loading={deletingId === garment.id}
                disabled={deletingId !== null && deletingId !== garment.id}
              >
                Delete garment
              </Button>
            </Popconfirm>
          </>
        );
      })()}
    </Space>
  ) : (
    <Empty description="No garments added yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />
  );

  if (isNarrow) {
    return (
      <Space direction="vertical" style={{ width: '100%' }} size={16}>
        {garments.length > 0 && (
          <Select
            style={{ width: '100%' }}
            value={selectedId}
            onChange={setSelectedId}
            options={garments.map((g) => ({ value: g.id, label: getEdit(g, 'name') }))}
          />
        )}
        {addControl}
        {detailPane}
      </Space>
    );
  }

  return (
    <div style={{ display: 'flex', width: '100%', alignItems: 'stretch' }}>
      <div
        style={{
          width: 240,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <Menu
          mode="inline"
          selectedKeys={selectedId ? [selectedId] : []}
          items={listItems}
          onClick={({ key }) => setSelectedId(key)}
          style={{ borderInlineEnd: 0 }}
        />
        <div style={{ padding: '0 8px 8px' }}>{addControl}</div>
      </div>
      <Divider type="vertical" style={{ height: 'auto', margin: '0 20px' }} />
      <div style={{ flex: 1, minWidth: 0 }}>{detailPane}</div>
    </div>
  );
}
