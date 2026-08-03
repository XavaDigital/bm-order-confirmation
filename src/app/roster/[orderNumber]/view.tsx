'use client';

/**
 * The short-URL roster page (David, 2026-08-03).
 *
 * Layout: the team vertically on the LEFT; clicking a name shows that
 * player's sizes on the RIGHT as per-garment stacked sections — each garment
 * with its mock-up images, notes, size pick and every custom option column
 * the garment defines (e.g. Colour). Guests add players via a dashed Add row
 * and may edit only the players they added (email = identity).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  App,
  Button,
  ConfigProvider,
  Divider,
  Empty,
  Grid,
  Image,
  Input,
  Popconfirm,
  Select,
  Skeleton,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import {
  CheckCircleFilled,
  DeleteOutlined,
  LockOutlined,
  PlusOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { darkTheme, BRAND } from '@/lib/theme';
import { SALES_REP_LABEL } from '@/lib/config';

const { Title, Text } = Typography;

interface GarmentOption {
  label: string;
  type: 'select' | 'text';
  options?: string[];
  defaultOption?: string;
  defaultValue?: string;
}

interface RosterGarment {
  id: string;
  name: string;
  notes: string | null;
  sizes: { label: string; tall: boolean }[];
  sizingColumns: GarmentOption[];
  images: { url: string; caption: string | null }[];
  sizeCharts: { name: string; url: string | null }[];
}

interface RosterMember {
  id: string;
  name: string;
  playerNumber: string | null;
  submittedAt: string | null;
  mine: boolean;
  addedBy: string | null;
  sizes: Record<string, { size: string | null; customValues: Record<string, string> | null }>;
}

interface RosterState {
  order: { orderNumber: string; clubName: string | null; name: string | null; locked: boolean };
  guest: { id: string; email: string; name: string | null };
  garments: RosterGarment[];
  members: RosterMember[];
}

interface Props {
  orderNumber: string;
  teamLabel: string;
  requiresPassword: boolean;
  hasSession: boolean;
  token: string | null;
}

/** Per-garment working values while adding/editing a player. */
type DraftSizes = Record<string, { size: string | null; customValues: Record<string, string> }>;

function emptyDraft(garments: RosterGarment[]): DraftSizes {
  return Object.fromEntries(
    garments.map((g) => [
      g.id,
      {
        size: null,
        customValues: Object.fromEntries(
          g.sizingColumns.map((c) => [
            c.label,
            (c.type === 'select' ? c.defaultOption : c.defaultValue) ?? '',
          ]),
        ),
      },
    ]),
  );
}

function draftFromMember(member: RosterMember, garments: RosterGarment[]): DraftSizes {
  const base = emptyDraft(garments);
  for (const [garmentId, entry] of Object.entries(member.sizes)) {
    if (base[garmentId]) {
      base[garmentId] = {
        size: entry.size,
        customValues: { ...base[garmentId].customValues, ...(entry.customValues ?? {}) },
      };
    }
  }
  return base;
}

export function RosterPageView({ orderNumber, teamLabel, requiresPassword, hasSession, token }: Props) {
  const { message } = App.useApp();
  const screens = Grid.useBreakpoint();
  const isNarrow = screens.md === false;

  // Gate stage
  const [entered, setEntered] = useState(hasSession);
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [guestName, setGuestName] = useState('');
  const [entering, setEntering] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);

  // Main stage
  const [state, setState] = useState<RosterState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | 'new' | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftNumber, setDraftNumber] = useState('');
  const [draftSizes, setDraftSizes] = useState<DraftSizes>({});
  const [saving, setSaving] = useState(false);

  const loadState = useCallback(async () => {
    try {
      const res = await fetch(`/api/roster/${encodeURIComponent(orderNumber)}/state`);
      if (res.status === 401) {
        setEntered(false);
        return;
      }
      if (!res.ok) throw new Error('Failed to load the roster');
      const data = (await res.json()) as RosterState;
      setState(data);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load the roster');
    }
  }, [orderNumber]);

  useEffect(() => {
    if (entered) void loadState();
  }, [entered, loadState]);

  const selectedMember = useMemo(
    () => (state && selectedId && selectedId !== 'new'
      ? state.members.find((m) => m.id === selectedId) ?? null
      : null),
    [state, selectedId],
  );

  // Default selection: my first member, else first member, else the add form.
  useEffect(() => {
    if (!state || selectedId !== null) return;
    const mine = state.members.find((m) => m.mine);
    setSelectedId(mine?.id ?? state.members[0]?.id ?? 'new');
  }, [state, selectedId]);

  // (Re)build the editable draft whenever the selection changes.
  useEffect(() => {
    if (!state) return;
    if (selectedId === 'new') {
      setDraftName('');
      setDraftNumber('');
      setDraftSizes(emptyDraft(state.garments));
    } else if (selectedMember) {
      setDraftName(selectedMember.name);
      setDraftNumber(selectedMember.playerNumber ?? '');
      setDraftSizes(draftFromMember(selectedMember, state.garments));
    }
  }, [state, selectedId, selectedMember]);

  async function enter() {
    if (!email.trim()) {
      setGateError('Enter your email address.');
      return;
    }
    setEntering(true);
    setGateError(null);
    try {
      const res = await fetch(`/api/roster/${encodeURIComponent(orderNumber)}/enter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          ...(guestName.trim() && { name: guestName.trim() }),
          ...(password && { password }),
          ...(token && { token }),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setGateError(
          res.status === 403
            ? 'Incorrect password.'
            : res.status === 429
              ? (data.error ?? 'Too many attempts — try again shortly.')
              : (data.error ?? 'Something went wrong. Please try again.'),
        );
        return;
      }
      setEntered(true);
    } catch {
      setGateError('Something went wrong. Please try again.');
    } finally {
      setEntering(false);
    }
  }

  const editable = Boolean(
    state && !state.order.locked && (selectedId === 'new' || selectedMember?.mine),
  );

  function sizesComplete(): boolean {
    if (!state) return false;
    return state.garments.every((g) => Boolean(draftSizes[g.id]?.size));
  }

  async function save() {
    if (!state) return;
    if (!draftName.trim()) {
      message.error('Enter the player’s name.');
      return;
    }
    if (!sizesComplete()) {
      message.error('Pick a size for every garment.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: draftName.trim(),
        playerNumber: draftNumber.trim() || null,
        sizes: state.garments.map((g) => ({
          garmentId: g.id,
          size: draftSizes[g.id].size!,
          customValues: Object.fromEntries(
            Object.entries(draftSizes[g.id].customValues).filter(([, v]) => v.trim()),
          ),
        })),
      };
      const isNew = selectedId === 'new';
      const res = await fetch(
        isNew
          ? `/api/roster/${encodeURIComponent(orderNumber)}/members`
          : `/api/roster/${encodeURIComponent(orderNumber)}/members/${selectedId}`,
        {
          method: isNew ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) setEntered(false);
        message.error(data.error ?? 'Failed to save.');
        return;
      }
      message.success(isNew ? `${payload.name} added` : 'Saved');
      if (isNew && data.memberId) setSelectedId(data.memberId as string);
      await loadState();
    } catch {
      message.error('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function removeMember(memberId: string) {
    try {
      const res = await fetch(
        `/api/roster/${encodeURIComponent(orderNumber)}/members/${memberId}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        message.error(data.error ?? 'Failed to remove.');
        return;
      }
      setSelectedId(null);
      await loadState();
    } catch {
      message.error('Failed to remove. Please try again.');
    }
  }

  // ── Gate stage ──
  if (!entered) {
    return (
      <ConfigProvider theme={darkTheme}>
        <div style={{ minHeight: '100vh', background: '#191919', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ maxWidth: 420, width: '100%', textAlign: 'center' }}>
            <TeamOutlined style={{ fontSize: 56, color: BRAND.primaryDark, marginBottom: 16 }} />
            <Title level={2} style={{ color: '#fff', marginBottom: 4 }}>
              {teamLabel}
            </Title>
            <Text style={{ color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: 28 }}>
              Team kit sizing — add yourself or your players, and pick sizes for each garment.
            </Text>

            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {requiresPassword && !token && (
                <Input.Password
                  size="large"
                  placeholder="Team password"
                  prefix={<LockOutlined />}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  maxLength={64}
                />
              )}
              <Input
                size="large"
                placeholder="Your email"
                type="email"
                prefix={<UserOutlined />}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onPressEnter={() => void enter()}
                maxLength={200}
              />
              <Input
                size="large"
                placeholder="Your name (optional)"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                onPressEnter={() => void enter()}
                maxLength={120}
              />
              <Button type="primary" size="large" block loading={entering} onClick={() => void enter()}>
                Continue
              </Button>
              {gateError && <Alert type="error" showIcon message={gateError} />}
              <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12 }}>
                Come back any time with the same email to update your players. No password to
                remember{requiresPassword ? ' beyond the team one' : ''} — your email is your key.
                Questions? Contact your {SALES_REP_LABEL}.
              </Text>
            </Space>
          </div>
        </div>
      </ConfigProvider>
    );
  }

  // ── Main stage ──
  const memberList = state && (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {state.members.map((m) => {
        const selected = m.id === selectedId;
        return (
          <button
            key={m.id}
            onClick={() => setSelectedId(m.id)}
            style={{
              textAlign: 'left',
              padding: '10px 12px',
              borderRadius: 6,
              border: `1px solid ${selected ? BRAND.primaryDark : 'rgba(255,255,255,0.1)'}`,
              background: selected ? 'rgba(79,70,229,0.15)' : 'rgba(255,255,255,0.03)',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            <Space size={8}>
              {m.submittedAt ? (
                <CheckCircleFilled style={{ color: '#52c41a' }} />
              ) : (
                <UserOutlined style={{ color: 'rgba(255,255,255,0.4)' }} />
              )}
              <span>
                {m.name}
                {m.playerNumber ? ` #${m.playerNumber}` : ''}
              </span>
              {m.mine && <Tag color="geekblue">yours</Tag>}
            </Space>
          </button>
        );
      })}
      {!state.order.locked && (
        <Button
          type="dashed"
          block
          icon={<PlusOutlined />}
          onClick={() => setSelectedId('new')}
          style={{ marginTop: 8 }}
        >
          Add a player
        </Button>
      )}
    </div>
  );

  const detail = state && (selectedId === 'new' || selectedMember) && (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {selectedId === 'new' ? (
        <Title level={4} style={{ color: '#fff', margin: 0 }}>
          New player
        </Title>
      ) : (
        <Space wrap>
          <Title level={4} style={{ color: '#fff', margin: 0 }}>
            {selectedMember!.name}
            {selectedMember!.playerNumber ? ` #${selectedMember!.playerNumber}` : ''}
          </Title>
          {!selectedMember!.mine && (
            <Tag>
              {selectedMember!.addedBy ? `added by ${selectedMember!.addedBy}` : 'added by the team'}
            </Tag>
          )}
        </Space>
      )}

      {editable && (
        <Space wrap>
          <Input
            placeholder="Player name"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            style={{ width: 220 }}
            maxLength={120}
          />
          <Input
            placeholder="Number (optional)"
            value={draftNumber}
            onChange={(e) => setDraftNumber(e.target.value)}
            style={{ width: 140 }}
            maxLength={20}
          />
        </Space>
      )}

      {!editable && selectedMember && !selectedMember.mine && !state.order.locked && (
        <Alert
          type="info"
          showIcon
          message="Only the person who added this player can change their sizes."
        />
      )}

      {state.garments.map((g) => {
        const draft = draftSizes[g.id];
        const current = selectedMember?.sizes[g.id];
        return (
          <div
            key={g.id}
            style={{
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8,
              padding: 16,
              background: 'rgba(255,255,255,0.03)',
            }}
          >
            <Title level={5} style={{ color: '#fff', marginTop: 0 }}>
              {g.name}
            </Title>
            {g.images.length > 0 && (
              <Image.PreviewGroup>
                <Space wrap style={{ marginBottom: 12 }}>
                  {g.images.map((img, i) => (
                    <Image
                      key={i}
                      src={img.url}
                      alt={img.caption ?? g.name}
                      width={88}
                      height={66}
                      style={{ objectFit: 'cover', borderRadius: 4 }}
                    />
                  ))}
                </Space>
              </Image.PreviewGroup>
            )}
            {g.notes && (
              <Text style={{ color: 'rgba(255,255,255,0.65)', display: 'block', marginBottom: 12, fontSize: 13 }}>
                {g.notes}
              </Text>
            )}

            {/* The stacked "table" of choices for this garment. */}
            <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', rowGap: 10, alignItems: 'center' }}>
              <Text style={{ color: 'rgba(255,255,255,0.65)' }}>Size</Text>
              {editable ? (
                <Select
                  placeholder="Pick a size"
                  value={draft?.size ?? undefined}
                  onChange={(v) =>
                    setDraftSizes((prev) => ({ ...prev, [g.id]: { ...prev[g.id], size: v } }))
                  }
                  options={g.sizes.flatMap((s) => [
                    { value: s.label, label: s.label },
                    ...(s.tall ? [{ value: `${s.label} Tall`, label: `${s.label} Tall` }] : []),
                  ])}
                  style={{ maxWidth: 260 }}
                />
              ) : (
                <Text style={{ color: '#fff' }}>{current?.size ?? '—'}</Text>
              )}

              {g.sizingColumns.map((col) => (
                <RosterOptionRow
                  key={col.label}
                  column={col}
                  editable={editable}
                  value={
                    editable
                      ? (draft?.customValues[col.label] ?? '')
                      : (current?.customValues?.[col.label] ?? '')
                  }
                  onChange={(v) =>
                    setDraftSizes((prev) => ({
                      ...prev,
                      [g.id]: {
                        ...prev[g.id],
                        customValues: { ...prev[g.id].customValues, [col.label]: v },
                      },
                    }))
                  }
                />
              ))}
            </div>

            {g.sizeCharts.length > 0 && (
              <Space wrap style={{ marginTop: 12 }}>
                {g.sizeCharts.map(
                  (c) =>
                    c.url && (
                      <a key={c.name} href={c.url} target="_blank" rel="noopener noreferrer">
                        <Tag color="geekblue">Size chart: {c.name}</Tag>
                      </a>
                    ),
                )}
              </Space>
            )}
          </div>
        );
      })}

      {editable && (
        <Space>
          <Button type="primary" size="large" loading={saving} onClick={() => void save()}>
            {selectedId === 'new' ? 'Add player' : 'Save changes'}
          </Button>
          {selectedId !== 'new' && selectedMember?.mine && (
            <Popconfirm
              title={`Remove ${selectedMember.name}?`}
              onConfirm={() => void removeMember(selectedMember.id)}
              okText="Remove"
              okType="danger"
            >
              <Button danger icon={<DeleteOutlined />}>
                Remove
              </Button>
            </Popconfirm>
          )}
        </Space>
      )}
    </Space>
  );

  return (
    <ConfigProvider theme={darkTheme}>
      <div style={{ minHeight: '100vh', background: '#191919', padding: '32px 16px' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <div style={{ marginBottom: 24 }}>
            <Title level={3} style={{ color: '#fff', marginBottom: 0 }}>
              {teamLabel} — team sizing
            </Title>
            {state && (
              <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>
                Signed in as {state.guest.name || state.guest.email}
              </Text>
            )}
          </div>

          {state?.order.locked && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message="The roster is locked for production"
              description={`Sizes can no longer be changed here — contact your ${SALES_REP_LABEL} if something is wrong.`}
            />
          )}

          {loadError ? (
            <Alert type="error" showIcon message={loadError} />
          ) : !state ? (
            <Spin>
              <Skeleton active paragraph={{ rows: 6 }} />
            </Spin>
          ) : state.members.length === 0 && state.order.locked ? (
            <Empty description={<Text style={{ color: 'rgba(255,255,255,0.5)' }}>No players</Text>} />
          ) : isNarrow ? (
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              {memberList}
              <Divider style={{ borderColor: 'rgba(255,255,255,0.1)', margin: '4px 0' }} />
              {detail}
            </Space>
          ) : (
            <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
              <div style={{ width: 260, flexShrink: 0 }}>{memberList}</div>
              <div style={{ flex: 1, minWidth: 0 }}>{detail}</div>
            </div>
          )}
        </div>
      </div>
    </ConfigProvider>
  );
}

function RosterOptionRow({
  column,
  editable,
  value,
  onChange,
}: {
  column: GarmentOption;
  editable: boolean;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <>
      <Text style={{ color: 'rgba(255,255,255,0.65)' }}>{column.label}</Text>
      {editable ? (
        column.type === 'select' ? (
          <Select
            allowClear
            placeholder={column.label}
            value={value || undefined}
            onChange={(v) => onChange(v ?? '')}
            options={(column.options ?? []).map((o) => ({ value: o, label: o }))}
            style={{ maxWidth: 260 }}
          />
        ) : (
          <Input
            placeholder={column.label}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            style={{ maxWidth: 260 }}
            maxLength={200}
          />
        )
      ) : (
        <Text style={{ color: '#fff' }}>{value || '—'}</Text>
      )}
    </>
  );
}
