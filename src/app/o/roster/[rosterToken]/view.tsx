'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Divider,
  Input,
  InputNumber,
  Space,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { CheckCircleFilled, DeleteOutlined, ImportOutlined, LockOutlined, PlusOutlined } from '@ant-design/icons';
import { SALES_REP_LABEL } from '@/lib/config';
import type { RosterGarment, RosterMemberDto, RosterNameListEntry, SizeChartLink } from '@/types/customer';
import { CustomerPageShell } from '@/components/customer/CustomerPageShell';
import { SectionHeading } from '@/components/customer/SectionHeading';
import { LockedRosterAlert } from '@/components/customer/LockedRosterAlert';
import { RosterSizeEntry, buildSizeDraft } from '@/components/customer/RosterSizeEntry';
import { NameListPreview } from '@/components/customer/NameListPreview';
import { BulkNameListUpload, type BulkUploadOutcome } from '@/components/customer/BulkNameListUpload';
import { mergeNameListEntries, type ParsedNameRow } from '@/components/customer/bulk-name-list';
import { SizeChartPreviewModal } from '@/components/customer/SizeChartPreviewModal';
import {
  CARD_STYLE,
  CARD_BODY_STYLES,
  DESCRIPTIONS_STYLES,
} from '@/components/customer/customerStyles';

const { Text, Paragraph } = Typography;

export interface RosterCustomerViewProps {
  rosterToken: string;
  roster: {
    orderNumber: string;
    clubName: string | null;
    locked: boolean;
    /**
     * Names print in CAPITALS (David, 2026-08-05) — saved values are
     * uppercased server-side; the UI only previews. Optional so older
     * callers/fixtures render without a notice rather than a wrong one.
     */
    namesUppercase?: boolean;
    garments: RosterGarment[];
    members: RosterMemberDto[];
  };
}

interface AddSelfDraft {
  name: string;
  playerNumber: string;
  email: string;
}

const EMPTY_ADD_SELF: AddSelfDraft = { name: '', playerNumber: '', email: '' };

export function RosterCustomerView({ rosterToken, roster }: RosterCustomerViewProps) {
  const [members, setMembers] = useState(roster.members);
  const [locked, setLocked] = useState(roster.locked);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(
    roster.members.length === 1 ? roster.members[0].id : null,
  );
  const [showAddSelf, setShowAddSelf] = useState(roster.members.length === 0);
  const [addSelfDraft, setAddSelfDraft] = useState<AddSelfDraft>(EMPTY_ADD_SELF);
  const [addingSelf, setAddingSelf] = useState(false);
  // "Got Your Back" style garments (GOT_YOUR_BACK_PLAN.md) carry a name list
  // instead of a per-member size — excluded from the sizing flow entirely.
  const sizingGarments = useMemo(() => roster.garments.filter((g) => !g.nameListEnabled), [roster.garments]);
  const nameListGarments = useMemo(() => roster.garments.filter((g) => g.nameListEnabled), [roster.garments]);
  const [nameLists, setNameLists] = useState<Record<string, { entries: RosterNameListEntry[]; rows: number | null }>>(
    () =>
      Object.fromEntries(
        nameListGarments.map((g) => [g.id, { entries: g.nameListEntries ?? [], rows: g.nameListRows ?? null }]),
      ),
  );

  const [sizeDraft, setSizeDraft] = useState<Record<string, string>>(() =>
    buildSizeDraft(roster.members[0] ?? null, sizingGarments),
  );
  const [savingSizes, setSavingSizes] = useState(false);
  const [chartPreview, setChartPreview] = useState<SizeChartLink | null>(null);

  // Preview-only styling — the SAVED value is uppercased server-side; never
  // transform the data client-side.
  const nameCaseStyle = roster.namesUppercase ? ({ textTransform: 'uppercase' } as const) : undefined;

  const selectedMember = members.find((member) => member.id === selectedMemberId) ?? null;
  const submittedCount = members.filter((member) => member.submittedAt !== null).length;
  // Teammates enter their own number independently, so this is exactly where
  // a collision most likely originates — flagged, not blocked, since a
  // shared/reissued number is still a legitimate choice.
  const addSelfNumberTaken = useMemo(() => {
    const typed = addSelfDraft.playerNumber.trim();
    return typed.length > 0 && members.some((m) => m.playerNumber?.trim() === typed);
  }, [addSelfDraft.playerNumber, members]);

  useEffect(() => {
    setSizeDraft(buildSizeDraft(selectedMember, sizingGarments));
  }, [selectedMemberId, selectedMember, sizingGarments]);

  async function handleAddSelf() {
    const name = addSelfDraft.name.trim();
    if (!name) {
      message.error('Please enter your name.');
      return;
    }

    setAddingSelf(true);
    try {
      const res = await fetch(`/api/o/roster/${rosterToken}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          playerNumber: addSelfDraft.playerNumber.trim() || undefined,
          email: addSelfDraft.email.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 409 && data.code === 'roster_locked') {
        setLocked(true);
        throw new Error(data.error ?? 'This roster is locked.');
      }
      if (!res.ok) throw new Error(data.error ?? 'Failed to add your name');

      setMembers((prev) => [...prev, data]);
      setSelectedMemberId(data.id);
      setShowAddSelf(false);
      setAddSelfDraft(EMPTY_ADD_SELF);
      message.success('Your name has been added to the team roster.');
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to add your name');
    } finally {
      setAddingSelf(false);
    }
  }

  async function handleSaveSizes() {
    if (!selectedMember) {
      message.error('Choose your name first.');
      return;
    }
    if (locked) {
      message.error(`This roster is locked. Please contact your ${SALES_REP_LABEL}.`);
      return;
    }

    const sizes = sizingGarments.map((garment) => ({
      garmentId: garment.id,
      size: (sizeDraft[garment.id] ?? '').trim(),
    }));

    if (sizes.some((row) => row.size.length === 0)) {
      message.error('Please enter a size for every garment.');
      return;
    }

    const wasSubmitted = selectedMember.submittedAt !== null;
    setSavingSizes(true);
    try {
      const res = await fetch(`/api/o/roster/${rosterToken}/members/${selectedMember.id}/sizes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sizes }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 409 && data.code === 'roster_locked') {
        setLocked(true);
        throw new Error(data.error ?? 'This roster is locked.');
      }
      if (!res.ok) throw new Error(data.error ?? 'Failed to save sizes');

      setMembers((prev) => prev.map((member) => (member.id === data.id ? data : member)));
      message.success(wasSubmitted ? 'Your sizes have been updated.' : 'Your sizes have been saved.');
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to save sizes');
    } finally {
      setSavingSizes(false);
    }
  }

  function updateNameListDraft(garmentId: string, entries: RosterNameListEntry[]) {
    setNameLists((prev) => ({ ...prev, [garmentId]: { ...prev[garmentId], entries } }));
  }

  async function saveNameList(garmentId: string) {
    const draft = nameLists[garmentId];
    if (!draft) return;
    try {
      const res = await fetch(`/api/o/roster/${rosterToken}/garments/${garmentId}/name-list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          draft.entries
            .filter((e) => e.name.trim())
            .map((e, i) => ({ ...(e.id ? { id: e.id } : {}), name: e.name.trim(), playerNumber: e.playerNumber || undefined, sortOrder: i })),
        ),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 409 && data.code === 'roster_locked') {
        setLocked(true);
        throw new Error(data.error ?? 'This roster is locked.');
      }
      if (!res.ok) throw new Error(data.error ?? 'Failed to save the name list');

      setNameLists((prev) => ({ ...prev, [garmentId]: { ...prev[garmentId], entries: data.entries ?? [] } }));
      message.success('Name list saved');
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to save the name list');
    }
  }

  async function saveNameListRows(garmentId: string, rows: number | null) {
    setNameLists((prev) => ({ ...prev, [garmentId]: { ...prev[garmentId], rows } }));
    try {
      const res = await fetch(`/api/o/roster/${rosterToken}/garments/${garmentId}/name-list/rows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nameListRows: rows }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.code === 'roster_locked') {
        setLocked(true);
        throw new Error(data.error ?? 'This roster is locked.');
      }
      if (!res.ok) throw new Error(data.error ?? 'Failed to save the row count');
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to save the row count');
    }
  }

  /**
   * Bulk upload (BulkNameListUpload): merge the parsed sheet into the draft,
   * then persist through the SAME name-list route the Save button uses. Throws
   * customer-readable errors — the upload box renders them inline.
   */
  async function bulkImportNames(
    garmentId: string,
    rows: ParsedNameRow[],
  ): Promise<BulkUploadOutcome> {
    const draft = nameLists[garmentId] ?? { entries: [], rows: null };
    const merged = mergeNameListEntries(draft.entries, rows); // throws over the 300 cap

    const res = await fetch(`/api/o/roster/${rosterToken}/garments/${garmentId}/name-list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        merged.entries
          .filter((e) => e.name.trim())
          .map((e, i) => ({ ...(e.id ? { id: e.id } : {}), name: e.name.trim(), playerNumber: e.playerNumber || undefined, sortOrder: i })),
      ),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409 && data.code === 'roster_locked') {
      setLocked(true);
      throw new Error(data.error ?? 'This roster is locked.');
    }
    if (!res.ok) throw new Error(data.error ?? 'Failed to save the uploaded names');

    setNameLists((prev) => ({ ...prev, [garmentId]: { ...prev[garmentId], entries: data.entries ?? [] } }));
    message.success(`Uploaded ${merged.added} name${merged.added === 1 ? '' : 's'} to ${roster.garments.find((g) => g.id === garmentId)?.name ?? 'the list'}`);
    return { added: merged.added, duplicates: merged.duplicates };
  }

  async function importNameListFromRoster(garmentId: string) {
    try {
      const res = await fetch(`/api/o/roster/${rosterToken}/garments/${garmentId}/name-list/import`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 409 && data.code === 'roster_locked') {
        setLocked(true);
        throw new Error(data.error ?? 'This roster is locked.');
      }
      if (!res.ok) throw new Error(data.error ?? 'Failed to import from roster');

      setNameLists((prev) => ({ ...prev, [garmentId]: { ...prev[garmentId], entries: data.entries ?? [] } }));
      message.success(data.imported > 0 ? `Imported ${data.imported} name${data.imported > 1 ? 's' : ''}` : 'No new roster names to import');
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to import from roster');
    }
  }

  return (
    <CustomerPageShell
      label="Team Roster"
      title={roster.clubName || roster.orderNumber}
      subtitle="Choose your name, check the size charts, and enter your size for each garment."
    >
      <Card style={CARD_STYLE} styles={CARD_BODY_STYLES}>
        <SectionHeading>Roster Summary</SectionHeading>
        <Descriptions column={{ xs: 1, sm: 2 }} size="small" styles={DESCRIPTIONS_STYLES}>
          <Descriptions.Item label="Order Number">{roster.orderNumber}</Descriptions.Item>
          {roster.clubName && (
            <Descriptions.Item label="Club">{roster.clubName}</Descriptions.Item>
          )}
          <Descriptions.Item label="Members Submitted">
            {submittedCount} of {members.length}
          </Descriptions.Item>
          <Descriptions.Item label="Roster Status">
            {locked ? (
              <Tag color="warning" icon={<LockOutlined />}>Locked</Tag>
            ) : (
              <Tag color="success">Open</Tag>
            )}
          </Descriptions.Item>
        </Descriptions>
        <Paragraph style={{ color: 'rgba(255,255,255,0.55)', marginTop: 16, marginBottom: 0 }}>
          Entering your sizes here does not confirm the final order — your team manager will
          review the roster and complete the final confirmation separately.
        </Paragraph>
      </Card>

      {locked && <LockedRosterAlert />}

      {/* Name-printing notice (David, 2026-08-05): what is saved IS what
          prints — loud when casing matters, subtle when CAPITALS is on. */}
      {roster.namesUppercase === false && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="Names will be printed exactly as entered — please check spelling and capitalisation."
        />
      )}
      {roster.namesUppercase === true && (
        <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, display: 'block', marginBottom: 16 }}>
          Names will be printed in CAPITALS.
        </Text>
      )}

      <Card style={CARD_STYLE} styles={CARD_BODY_STYLES}>
        <SectionHeading>1. Choose Your Name</SectionHeading>

        {members.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
            {members.map((member) => {
              const selected = member.id === selectedMemberId;
              return (
                <Button
                  key={member.id}
                  type={selected ? 'primary' : 'default'}
                  onClick={() => setSelectedMemberId(member.id)}
                  style={{
                    height: 'auto',
                    padding: '12px 14px',
                    minWidth: 170,
                    textAlign: 'left',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600 }}>{member.name}</div>
                    <div style={{ fontSize: 12, opacity: 0.75 }}>
                      {member.playerNumber ? `#${member.playerNumber}` : 'No number listed'}
                    </div>
                    <div style={{ marginTop: 8 }}>
                      {member.submittedAt ? (
                        <Tag color="success" style={{ marginInlineEnd: 0 }}>
                          Submitted
                        </Tag>
                      ) : (
                        <Tag style={{ marginInlineEnd: 0 }}>Pending</Tag>
                      )}
                    </div>
                  </div>
                </Button>
              );
            })}
          </div>
        ) : (
          <Alert
            type="info"
            showIcon
            message="No team members have been added yet."
            description="Add your name below to start the roster."
            style={{ marginBottom: 16 }}
          />
        )}

        {!showAddSelf ? (
          <Button
            icon={<PlusOutlined />}
            onClick={() => setShowAddSelf(true)}
            disabled={locked}
          >
            Add my name
          </Button>
        ) : (
          <div
            style={{
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8,
              padding: 16,
              background: 'rgba(255,255,255,0.02)',
            }}
          >
            <Text strong style={{ display: 'block', marginBottom: 12 }}>
              Add yourself to the roster
            </Text>
            <Space wrap style={{ marginBottom: addSelfNumberTaken ? 4 : 12 }}>
              <Input
                placeholder="Your name"
                value={addSelfDraft.name}
                onChange={(e) => setAddSelfDraft((draft) => ({ ...draft, name: e.target.value }))}
                style={{ width: 180, ...nameCaseStyle }}
              />
              <Input
                placeholder="Player number (optional)"
                value={addSelfDraft.playerNumber}
                status={addSelfNumberTaken ? 'warning' : undefined}
                onChange={(e) =>
                  setAddSelfDraft((draft) => ({ ...draft, playerNumber: e.target.value }))
                }
                style={{ width: 180 }}
              />
              <Input
                placeholder="Email (optional)"
                value={addSelfDraft.email}
                onChange={(e) => setAddSelfDraft((draft) => ({ ...draft, email: e.target.value }))}
                style={{ width: 220 }}
              />
            </Space>
            {addSelfNumberTaken && (
              <Text type="warning" style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
                Someone already has #{addSelfDraft.playerNumber.trim()} on this roster — that&apos;s
                OK if it&apos;s shared or reissued, otherwise double-check with your team.
              </Text>
            )}
            <Space wrap>
              <Button
                type="primary"
                loading={addingSelf}
                onClick={handleAddSelf}
                disabled={locked}
              >
                Add me to the roster
              </Button>
              <Button
                onClick={() => {
                  setShowAddSelf(false);
                  setAddSelfDraft(EMPTY_ADD_SELF);
                }}
                disabled={addingSelf}
              >
                Cancel
              </Button>
            </Space>
          </div>
        )}
      </Card>

      <Card style={CARD_STYLE} styles={CARD_BODY_STYLES}>
        <SectionHeading>2. Enter Your Sizes</SectionHeading>

        {!selectedMember ? (
          <Alert
            type="info"
            showIcon
            message="Choose your name above to continue."
            style={{ marginBottom: 0 }}
          />
        ) : (
          <>
            <div style={{ marginBottom: 16 }}>
              <Text strong style={{ color: '#fff', fontSize: 16 }}>
                {selectedMember.name}
              </Text>
              <Text style={{ color: 'rgba(255,255,255,0.55)', marginLeft: 8 }}>
                {selectedMember.playerNumber ? `Player #${selectedMember.playerNumber}` : 'No player number listed'}
              </Text>
            </div>

            {selectedMember.submittedAt && (
              <Alert
                type="success"
                showIcon
                icon={<CheckCircleFilled />}
                message="You have already submitted sizes for this roster."
                description="You can update them below if something needs to change."
                style={{ marginBottom: 20 }}
              />
            )}

            {sizingGarments.map((garment, idx) => (
              <RosterSizeEntry
                key={garment.id}
                garment={garment}
                index={idx}
                value={sizeDraft[garment.id] ?? ''}
                onChange={(v) => setSizeDraft((draft) => ({ ...draft, [garment.id]: v }))}
                disabled={locked || savingSizes}
                onPreviewChart={setChartPreview}
              />
            ))}

            <Divider style={{ borderColor: 'rgba(255,255,255,0.1)' }} />

            <Button
              type="primary"
              size="large"
              loading={savingSizes}
              disabled={locked}
              onClick={handleSaveSizes}
            >
              {selectedMember.submittedAt ? 'Update my sizes' : 'Save my sizes'}
            </Button>
          </>
        )}
      </Card>

      {nameListGarments.map((garment) => {
        const draft = nameLists[garment.id] ?? { entries: [], rows: null };
        return (
          <Card key={garment.id} style={CARD_STYLE} styles={CARD_BODY_STYLES}>
            <SectionHeading>&ldquo;Got Your Back&rdquo; Name List — {garment.name}</SectionHeading>
            <Paragraph style={{ color: 'rgba(255,255,255,0.55)', marginTop: 0 }}>
              Add every name you want printed on this design, and set how many rows to arrange
              them in.
            </Paragraph>
            <Space wrap style={{ marginBottom: 12 }}>
              <Text>Rows:</Text>
              <InputNumber
                min={1}
                max={100}
                value={draft.rows ?? undefined}
                disabled={locked}
                onChange={(v) => saveNameListRows(garment.id, v ?? null)}
              />
              <Tooltip title="Copy in any team roster names not already on this list">
                <Button
                  icon={<ImportOutlined />}
                  disabled={locked}
                  onClick={() => importNameListFromRoster(garment.id)}
                >
                  Import from roster
                </Button>
              </Tooltip>
            </Space>
            <BulkNameListUpload
              garmentName={garment.name}
              disabled={locked}
              onImport={(rows) => bulkImportNames(garment.id, rows)}
            />
            <Space direction="vertical" style={{ width: '100%' }} size={8}>
              {draft.entries.map((entry, i) => (
                <Space key={entry.id || `new-${i}`} wrap>
                  <Input
                    placeholder="Name"
                    value={entry.name}
                    disabled={locked}
                    style={{ width: 200, ...nameCaseStyle }}
                    onChange={(e) => {
                      const next = [...draft.entries];
                      next[i] = { ...next[i], name: e.target.value };
                      updateNameListDraft(garment.id, next);
                    }}
                  />
                  <Input
                    placeholder="# (optional)"
                    value={entry.playerNumber ?? ''}
                    disabled={locked}
                    style={{ width: 120 }}
                    onChange={(e) => {
                      const next = [...draft.entries];
                      next[i] = { ...next[i], playerNumber: e.target.value };
                      updateNameListDraft(garment.id, next);
                    }}
                  />
                  <Button
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    disabled={locked}
                    onClick={() => updateNameListDraft(garment.id, draft.entries.filter((_, j) => j !== i))}
                  />
                </Space>
              ))}
              <Button
                type="dashed"
                icon={<PlusOutlined />}
                disabled={locked}
                onClick={() =>
                  updateNameListDraft(garment.id, [
                    ...draft.entries,
                    { id: '', name: '', playerNumber: null },
                  ])
                }
              >
                Add name
              </Button>
            </Space>

            <NameListPreview entries={draft.entries} rows={draft.rows} />

            <Divider style={{ borderColor: 'rgba(255,255,255,0.1)' }} />
            <Button type="primary" disabled={locked} onClick={() => saveNameList(garment.id)}>
              Save name list
            </Button>
          </Card>
        );
      })}

      <SizeChartPreviewModal chart={chartPreview} onClose={() => setChartPreview(null)} />
    </CustomerPageShell>
  );
}
