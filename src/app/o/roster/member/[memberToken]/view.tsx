'use client';

import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Divider,
  Tag,
  Typography,
  message,
} from 'antd';
import { CheckCircleFilled, LockOutlined } from '@ant-design/icons';
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

const { Paragraph } = Typography;

export interface RosterMemberViewProps {
  memberToken: string;
  roster: {
    orderNumber: string;
    clubName: string | null;
    locked: boolean;
    /**
     * Names print in CAPITALS (David, 2026-08-05). Optional so older
     * callers/fixtures render without a notice rather than a wrong one.
     */
    namesUppercase?: boolean;
    garments: RosterGarment[];
    member: RosterMemberDto;
  };
}

export function RosterMemberView({ memberToken, roster }: RosterMemberViewProps) {
  const [member, setMember] = useState(roster.member);
  const [locked, setLocked] = useState(roster.locked);
  // "Got Your Back" style garments (GOT_YOUR_BACK_PLAN.md) carry a name list
  // instead of a per-member size — excluded here; the manager edits that list
  // directly on the shared roster link, not per individual member.
  const sizingGarments = useMemo(() => roster.garments.filter((g) => !g.nameListEnabled), [roster.garments]);
  const [sizeDraft, setSizeDraft] = useState<Record<string, string>>(() =>
    buildSizeDraft(roster.member, sizingGarments),
  );
  const [savingSizes, setSavingSizes] = useState(false);
  const [chartPreview, setChartPreview] = useState<SizeChartLink | null>(null);

  async function handleSaveSizes() {
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

    const wasSubmitted = member.submittedAt !== null;
    setSavingSizes(true);
    try {
      const res = await fetch(`/api/o/roster/member/${memberToken}/sizes`, {
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

      setMember(data);
      message.success(wasSubmitted ? 'Your sizes have been updated.' : 'Your sizes have been saved.');
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to save sizes');
    } finally {
      setSavingSizes(false);
    }
  }

  return (
    <CustomerPageShell
      label="Your Size"
      title={member.name}
      subtitle="Check the size charts and enter your size for each garment below."
    >
      <Card style={CARD_STYLE} styles={CARD_BODY_STYLES}>
        <SectionHeading>Order Summary</SectionHeading>
        <Descriptions column={{ xs: 1, sm: 2 }} size="small" styles={DESCRIPTIONS_STYLES}>
          <Descriptions.Item label="Order Number">{roster.orderNumber}</Descriptions.Item>
          {roster.clubName && (
            <Descriptions.Item label="Club">{roster.clubName}</Descriptions.Item>
          )}
          <Descriptions.Item label="Player Number">
            {member.playerNumber ? `#${member.playerNumber}` : 'Not listed'}
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

      {/* Name-printing notice (David, 2026-08-05): what is saved IS what prints. */}
      {roster.namesUppercase === false && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="Names will be printed exactly as entered — please check spelling and capitalisation."
        />
      )}
      {roster.namesUppercase === true && (
        <Paragraph style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginBottom: 16 }}>
          Names will be printed in CAPITALS.
        </Paragraph>
      )}

      <Card style={CARD_STYLE} styles={CARD_BODY_STYLES}>
        <SectionHeading>Enter Your Sizes</SectionHeading>

        {member.submittedAt && (
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
          {member.submittedAt ? 'Update my sizes' : 'Save my sizes'}
        </Button>
      </Card>

      <SizeChartPreviewModal chart={chartPreview} onClose={() => setChartPreview(null)} />
    </CustomerPageShell>
  );
}
