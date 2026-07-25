'use client';

import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Divider,
  Input,
  Space,
  Tag,
  Typography,
  message,
} from 'antd';
import { CheckCircleFilled, LockOutlined, PlusOutlined } from '@ant-design/icons';
import { SALES_REP_LABEL } from '@/lib/config';
import type { RosterGarment, RosterMemberDto, SizeChartLink } from '@/types/customer';
import { CustomerPageShell } from '@/components/customer/CustomerPageShell';
import { SectionHeading } from '@/components/customer/SectionHeading';
import { LockedRosterAlert } from '@/components/customer/LockedRosterAlert';
import { RosterSizeEntry, buildSizeDraft } from '@/components/customer/RosterSizeEntry';
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
  const [sizeDraft, setSizeDraft] = useState<Record<string, string>>(() =>
    buildSizeDraft(roster.members[0] ?? null, roster.garments),
  );
  const [savingSizes, setSavingSizes] = useState(false);
  const [chartPreview, setChartPreview] = useState<SizeChartLink | null>(null);

  const selectedMember = members.find((member) => member.id === selectedMemberId) ?? null;
  const submittedCount = members.filter((member) => member.submittedAt !== null).length;

  useEffect(() => {
    setSizeDraft(buildSizeDraft(selectedMember, roster.garments));
  }, [selectedMemberId, selectedMember, roster.garments]);

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

    const sizes = roster.garments.map((garment) => ({
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
            <Space wrap style={{ marginBottom: 12 }}>
              <Input
                placeholder="Your name"
                value={addSelfDraft.name}
                onChange={(e) => setAddSelfDraft((draft) => ({ ...draft, name: e.target.value }))}
                style={{ width: 180 }}
              />
              <Input
                placeholder="Player number (optional)"
                value={addSelfDraft.playerNumber}
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

            {roster.garments.map((garment, idx) => (
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

      <SizeChartPreviewModal chart={chartPreview} onClose={() => setChartPreview(null)} />
    </CustomerPageShell>
  );
}
