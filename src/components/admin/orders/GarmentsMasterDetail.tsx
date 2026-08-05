'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
  Checkbox,
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
import { SectionTitle } from '@/components/admin/SectionTitle';
import { SizingTable } from './SizingTable';
import { NameListTable } from './NameListTable';
import { MockupUploader, type MockupImage } from './MockupUploader';
import { SizeChartLinker } from './SizeChartLinker';
import { ApiError, postJson, patchJson, deleteJson, getJson } from '@/lib/api-fetch';
import { unionChartSizes } from '@/lib/sizes';
import {
  missingRequiredOptions,
  resolveVisibleOptions,
  visibleOptionLabels,
  typeOptionDefaults,
} from '@/server/garment-types/visibility';

interface SizingRow {
  id?: string;
  size?: string | null;
  playerName?: string | null;
  playerNumber?: string | null;
  notes?: string | null;
  customValues?: Record<string, string> | null;
  sortOrder?: number;
}

interface NameListEntry {
  id?: string;
  name?: string | null;
  playerNumber?: string | null;
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
  sizingColumns?: GarmentTypeOption[];
  /** "Got Your Back" style — see GOT_YOUR_BACK_PLAN.md. */
  nameListEnabled?: boolean;
  nameListRows?: number | null;
  nameListEntries?: NameListEntry[];
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
export function GarmentsMasterDetail({
  orderId,
  initialGarments,
  onGarmentsChanged,
}: Props) {
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
  /**
   * Non-null while the blank new-garment form is open in the detail pane
   * (David, 2026-08-03): "Add" opens a blank form to fill and save, replacing
   * the old squashed name-input-then-edit-anyway flow.
   */
  const [draft, setDraft] = useState<{ name: string; garmentTypeId: string | null; notes: string } | null>(null);
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

  /**
   * Column definitions are structure rather than a draft field edit, so they
   * PATCH immediately — otherwise a staff member adds a column, types values
   * into it, and loses the column if they never hit "Save garment".
   */
  async function saveSizingColumns(garmentId: string, columns: GarmentTypeOption[]) {
    await patchJson(
      `/api/admin/orders/${orderId}/garments/${garmentId}`,
      { sizingColumns: columns },
      'Failed to save the column',
    );
    setGarments((prev) =>
      prev.map((g) => (g.id === garmentId ? { ...g, sizingColumns: columns } : g)),
    );
    message.success('Columns updated');
    onGarmentsChanged?.();
  }

  async function saveGarment(garment: Garment) {
    const edits = localEdits[garment.id] ?? {};
    if (Object.keys(edits).length === 0) return;

    // Required options (David, 2026-08-06): mirror the server's rule — a save
    // that touches the options or the type is blocked while a VISIBLE required
    // option is unanswered. Unrelated edits (a rename) stay unblocked, same as
    // the service.
    const touchesOptionsOrType =
      edits.selectedOptions !== undefined || edits.garmentTypeId !== undefined;
    const effectiveTypeId =
      edits.garmentTypeId !== undefined ? edits.garmentTypeId : garment.garmentTypeId;
    const effectiveType = effectiveTypeId ? types.find((t) => t.id === effectiveTypeId) : null;
    if (touchesOptionsOrType && effectiveType) {
      const effectiveOptions =
        edits.selectedOptions !== undefined ? edits.selectedOptions : garment.selectedOptions;
      const missing = missingRequiredOptions(effectiveType.orderOptions, effectiveOptions);
      if (missing.length > 0) {
        message.error(`Required options not set: ${missing.join(', ')}`);
        return;
      }
    }

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
          ...(edits.nameListEnabled !== undefined && { nameListEnabled: edits.nameListEnabled }),
          ...(edits.nameListRows !== undefined && { nameListRows: edits.nameListRows }),
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
    } catch (err) {
      // A 409 (e.g. the server's required-options check) carries the message
      // staff need to see — only fall back to the generic line otherwise.
      message.error(err instanceof ApiError ? err.message : 'Failed to save garment');
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

  async function saveDraft() {
    if (!draft || !draft.name.trim()) {
      message.warning('Enter a garment name');
      return;
    }
    setAddingLoading(true);
    try {
      const garment = await postJson<Pick<Garment, 'id' | 'name' | 'notes' | 'sortOrder'> & { fabrics?: string[]; garmentTypeId?: string | null; selectedOptions?: Record<string, string> | null; sizingColumns?: GarmentTypeOption[]; sizeChartIds?: string[] }>(
        `/api/admin/orders/${orderId}/garments`,
        {
          name: draft.name.trim(),
          // The server applies the type's presets (charts auto-link, option
          // defaults) on create — resolveGarmentTypePreset.
          ...(draft.garmentTypeId && { garmentTypeId: draft.garmentTypeId }),
          ...(draft.notes.trim() && { notes: draft.notes.trim() }),
        },
        'Failed to add garment',
      );
      setGarments((prev) => [
        ...prev,
        {
          ...garment,
          fabrics: garment.fabrics ?? [],
          sizing: [],
          images: [],
          // The server auto-links the type's size charts on create.
          sizeChartIds: garment.sizeChartIds ?? [],
          garmentTypeId: garment.garmentTypeId ?? null,
          selectedOptions: garment.selectedOptions ?? null,
          sizingColumns: garment.sizingColumns ?? [],
        },
      ]);
      setSelectedId(garment.id);
      setDraft(null);
      message.success('Garment added');
      onGarmentsChanged?.();
    } catch (err) {
      // addGarment 409s when the picked type has a required option no default
      // fills — surface which one rather than a generic failure.
      message.error(err instanceof ApiError ? err.message : 'Failed to add garment');
    } finally {
      setAddingLoading(false);
    }
  }

  const addControl = (
    <Button
      block
      type="dashed"
      icon={<PlusOutlined />}
      onClick={() => {
        setDraft({ name: '', garmentTypeId: null, notes: '' });
        setSelectedId(null);
      }}
      disabled={draft !== null}
    >
      Add garment
    </Button>
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

  const draftPane = draft && (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <Typography.Text strong>New garment</Typography.Text>
      <Form layout="vertical" size="small">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
          <Form.Item label="Garment Name" required>
            <Input
              autoFocus
              placeholder="e.g. Home Jersey"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              onPressEnter={() => void saveDraft()}
            />
          </Form.Item>
          <Form.Item
            label="Type"
            extra="Applying a type auto-links its size charts and option defaults on save."
          >
            <Select
              allowClear
              placeholder="No type"
              value={draft.garmentTypeId ?? undefined}
              onChange={(v) => setDraft({ ...draft, garmentTypeId: v ?? null })}
              options={types
                .filter((t) => t.isActive)
                .map((t) => ({
                  value: t.id,
                  label: t.category ? `${t.name} (${t.category})` : t.name,
                }))}
            />
          </Form.Item>
        </div>
        <Form.Item
          label="Customer note"
          extra="Shown to the customer on their confirmation page, under this garment. Staff-only discussion belongs in the order notes."
        >
          <Input.TextArea
            rows={2}
            placeholder="e.g. Sleeve print uses last season's artwork"
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          />
        </Form.Item>
      </Form>
      <Space>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          loading={addingLoading}
          onClick={() => void saveDraft()}
        >
          Save garment
        </Button>
        <Button
          disabled={addingLoading}
          onClick={() => {
            setDraft(null);
            setSelectedId(garments[0]?.id ?? null);
          }}
        >
          Cancel
        </Button>
      </Space>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        Mock-ups, sizing and size charts are added after saving.
      </Typography.Text>
    </Space>
  );

  const detailPane = draft ? (
    draftPane
  ) : selected ? (
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
        const currentNameListEnabled = getEdit(garment, 'nameListEnabled') ?? false;
        const currentNameListRows = getEdit(garment, 'nameListRows') ?? null;
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
            selectedOptions: { ...typeOptionDefaults(type.orderOptions), ...currentOptions },
          });
        }

        /** Set one option's value, pruning any child that becomes hidden as a result. */
        function updateOption(label: string, val: string) {
          setEdit(garment.id, {
            selectedOptions: resolveVisibleOptions(currentType!.orderOptions, {
              ...currentOptions,
              [label]: val,
            }),
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
                  <SectionTitle style={{ marginBottom: 8 }}>Fabrics</SectionTitle>
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
                <Form.Item
                  label="Customer note"
                  extra="Shown to the customer on their confirmation page, under this garment."
                >
                  <Input.TextArea
                    rows={2}
                    value={currentNotes ?? ''}
                    onChange={(e) => setEdit(garment.id, { notes: e.target.value || null })}
                    placeholder="e.g. Chinese collar, sublimated"
                  />
                </Form.Item>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                <Form.Item
                  label={'"Got Your Back" style'}
                  extra="Many names printed on one shared design, arranged in rows for the artwork — independent of the sizing table below."
                >
                  <Switch
                    checked={currentNameListEnabled}
                    onChange={(checked) => setEdit(garment.id, { nameListEnabled: checked })}
                  />
                </Form.Item>
                {currentNameListEnabled && (
                  <Form.Item label="Rows" extra="Row count for the print layout.">
                    <InputNumber
                      min={1}
                      max={100}
                      value={currentNameListRows ?? undefined}
                      onChange={(v) => setEdit(garment.id, { nameListRows: v ?? null })}
                      style={{ width: '100%' }}
                    />
                  </Form.Item>
                )}
              </div>
              {(() => {
                if (!currentType || currentType.orderOptions.length === 0) return null;
                const visibleLabels = visibleOptionLabels(currentType.orderOptions, currentOptions);
                const visibleOpts = currentType.orderOptions.filter((opt) => visibleLabels.has(opt.label));
                if (visibleOpts.length === 0) return null;
                return (
                  <>
                    <SectionTitle style={{ marginBottom: 8 }}>Options</SectionTitle>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                      {visibleOpts.map((opt) => (
                        <Form.Item
                          key={opt.label}
                          label={opt.label}
                          // Renders antd's red asterisk; a checkbox is never
                          // required (unchecked is an answer).
                          required={opt.type !== 'checkbox' && opt.required === true}
                        >
                          {opt.type === 'select' ? (
                            <Select
                              value={currentOptions[opt.label] || undefined}
                              onChange={(v) => updateOption(opt.label, v ?? '')}
                              allowClear
                              placeholder={`Select ${opt.label.toLowerCase()}`}
                              options={opt.options.map((o) => ({ value: o, label: o }))}
                            />
                          ) : opt.type === 'checkbox' ? (
                            <Checkbox
                              checked={currentOptions[opt.label] === 'true'}
                              onChange={(e) => updateOption(opt.label, e.target.checked ? 'true' : 'false')}
                            />
                          ) : (
                            <Input
                              value={currentOptions[opt.label] ?? ''}
                              onChange={(e) => updateOption(opt.label, e.target.value)}
                              placeholder={opt.label}
                            />
                          )}
                        </Form.Item>
                      ))}
                    </div>
                  </>
                );
              })()}
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

            <div>
              <SectionTitle style={{ marginBottom: 8 }}>Mock-up Images</SectionTitle>
              <MockupUploader
                key={garment.id}
                orderId={orderId}
                garmentId={garment.id}
                initialImages={garment.images}
              />
            </div>

            <div>
              <SectionTitle style={{ marginBottom: 8 }}>Sizing</SectionTitle>
              <SizingTable
                key={garment.id}
                orderId={orderId}
                garmentId={garment.id}
                initialRows={garment.sizing}
                allowedSizes={allowedSizes}
                onSaved={onGarmentsChanged}
                sizingColumns={garment.sizingColumns ?? []}
                onColumnsChange={(columns) => saveSizingColumns(garment.id, columns)}
              />
            </div>

            {garment.nameListEnabled && (
              <div>
                <SectionTitle style={{ marginBottom: 8 }}>
                  &ldquo;Got Your Back&rdquo; Name List
                </SectionTitle>
                <NameListTable
                  key={garment.id}
                  orderId={orderId}
                  garmentId={garment.id}
                  initialEntries={garment.nameListEntries ?? []}
                  onSaved={onGarmentsChanged}
                />
              </div>
            )}

            <div>
              <SectionTitle style={{ marginBottom: 8 }}>Reference Size Charts</SectionTitle>
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

            {/* The per-garment note thread is gone (David, 2026-08-03: one
                place for notes) — tag a garment from the order notes rail
                instead. */}
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
            onChange={(id) => {
              setDraft(null);
              setSelectedId(id);
            }}
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
          // Sized and padded like the order page's section menu (David,
          // 2026-08-04) — a narrow, compact rail so the detail gets the room.
          width: 180,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          // Pinned while the garment editor scrolls (David, 2026-08-04) —
          // switching garments must not require scrolling back up. Top offset
          // clears the fixed app header; capped height keeps a long garment
          // list scrollable within the rail itself.
          position: 'sticky',
          top: 88,
          alignSelf: 'flex-start',
          maxHeight: 'calc(100vh - 104px)',
          overflowY: 'auto',
        }}
      >
        <Menu
          mode="inline"
          inlineIndent={12}
          selectedKeys={selectedId ? [selectedId] : []}
          items={listItems}
          onClick={({ key }) => {
            // Picking a garment abandons an unsaved blank form.
            setDraft(null);
            setSelectedId(key);
          }}
          style={{ borderInlineEnd: 0 }}
        />
        {addControl}
      </div>
      <Divider type="vertical" style={{ height: 'auto', margin: '0 12px' }} />
      <div style={{ flex: 1, minWidth: 0 }}>{detailPane}</div>
    </div>
  );
}
