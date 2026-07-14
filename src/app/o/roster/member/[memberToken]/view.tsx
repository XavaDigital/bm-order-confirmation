'use client';

import { useState } from 'react';
import Image from 'next/image';
import {
  Alert,
  Button,
  Card,
  ConfigProvider,
  Descriptions,
  Divider,
  Input,
  Modal,
  Space,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  CheckCircleFilled,
  FileImageOutlined,
  FilePdfOutlined,
  LockOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { APP_NAME, SALES_REP_LABEL } from '@/lib/config';
import { BEASTMODE, darkTheme, headingFont } from '@/lib/theme';

const { Title, Text, Paragraph } = Typography;

interface SizeChartLink {
  name: string;
  storageKey: string | null;
  url: string | null;
  downloadUrl: string | null;
}

interface GarmentData {
  id: string;
  name: string;
  notes: string | null;
  sizeCharts: SizeChartLink[];
}

interface RosterMember {
  id: string;
  name: string;
  playerNumber: string | null;
  submittedAt: string | null;
  sizes: { garmentId: string; size: string | null }[];
}

export interface RosterMemberViewProps {
  memberToken: string;
  roster: {
    orderNumber: string;
    clubName: string | null;
    locked: boolean;
    garments: GarmentData[];
    member: RosterMember;
  };
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        borderLeft: `4px solid ${BEASTMODE.accent}`,
        paddingLeft: 12,
        marginBottom: 20,
      }}
    >
      <Title
        level={4}
        style={{
          margin: 0,
          color: '#fff',
          textTransform: 'uppercase',
          letterSpacing: 2,
          fontSize: 13,
          fontFamily: headingFont,
          fontWeight: 400,
        }}
      >
        {children}
      </Title>
    </div>
  );
}

function buildSizeDraft(member: RosterMember, garments: GarmentData[]) {
  const existing = new Map(member.sizes.map((row) => [row.garmentId, row.size ?? '']));
  return Object.fromEntries(garments.map((garment) => [garment.id, existing.get(garment.id) ?? '']));
}

export function RosterMemberView({ memberToken, roster }: RosterMemberViewProps) {
  const [member, setMember] = useState(roster.member);
  const [locked, setLocked] = useState(roster.locked);
  const [sizeDraft, setSizeDraft] = useState<Record<string, string>>(() =>
    buildSizeDraft(roster.member, roster.garments),
  );
  const [savingSizes, setSavingSizes] = useState(false);
  const [chartPreview, setChartPreview] = useState<SizeChartLink | null>(null);

  const cardStyle = {
    background: BEASTMODE.charcoal,
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 8,
    marginBottom: 24,
  };

  async function handleSaveSizes() {
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
    <ConfigProvider theme={darkTheme}>
      <div style={{ minHeight: '100vh', background: BEASTMODE.navy }}>
        <header
          style={{
            background: BEASTMODE.ink,
            borderBottom: `3px solid ${BEASTMODE.accent}`,
            padding: '24px',
          }}
        >
          <div style={{ maxWidth: 860, margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
              <Image
                src="/logo.svg"
                alt={APP_NAME}
                width={141}
                height={44}
                priority
                style={{ display: 'block' }}
              />
              <div
                style={{
                  width: 1,
                  height: 24,
                  background: 'rgba(255,255,255,0.2)',
                  flexShrink: 0,
                }}
              />
              <div
                style={{
                  fontSize: 11,
                  color: 'rgba(255,255,255,0.5)',
                  letterSpacing: 3,
                  textTransform: 'uppercase',
                  fontWeight: 600,
                }}
              >
                Your Size
              </div>
            </div>
            <Title level={2} style={{ color: '#fff', margin: 0, fontWeight: 900, letterSpacing: 1 }}>
              {member.name}
            </Title>
            <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 15, marginTop: 4, display: 'block' }}>
              Check the size charts and enter your size for each garment below.
            </Text>
          </div>
        </header>

        <main style={{ maxWidth: 860, margin: '0 auto', padding: '32px 24px 80px' }}>
          <Card style={cardStyle} styles={{ body: { padding: '20px 24px' } }}>
            <SectionHeading>Order Summary</SectionHeading>
            <Descriptions
              column={{ xs: 1, sm: 2 }}
              size="small"
              styles={{
                label: { color: 'rgba(255,255,255,0.45)', fontSize: 12 },
                content: { color: 'rgba(255,255,255,0.9)' },
              }}
            >
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

          {locked && (
            <Alert
              type="warning"
              showIcon
              message="This roster is locked"
              description={`Please contact your ${SALES_REP_LABEL} if you need any changes.`}
              style={{
                marginBottom: 24,
                background: 'rgba(250,173,20,0.08)',
                border: '1px solid rgba(250,173,20,0.3)',
              }}
            />
          )}

          <Card style={cardStyle} styles={{ body: { padding: '20px 24px' } }}>
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

            {roster.garments.map((garment, idx) => (
              <div
                key={garment.id}
                style={{
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 8,
                  padding: 16,
                  marginBottom: 16,
                  background: 'rgba(255,255,255,0.02)',
                }}
              >
                <Text strong style={{ color: '#fff', display: 'block', marginBottom: 6 }}>
                  Garment {idx + 1} — {garment.name}
                </Text>
                {garment.notes && (
                  <Paragraph style={{ color: 'rgba(255,255,255,0.55)', marginBottom: 12 }}>
                    {garment.notes}
                  </Paragraph>
                )}

                {garment.sizeCharts.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <Text
                      style={{
                        color: 'rgba(255,255,255,0.45)',
                        fontSize: 12,
                        textTransform: 'uppercase',
                        letterSpacing: 1,
                        display: 'block',
                        marginBottom: 8,
                      }}
                    >
                      <TeamOutlined style={{ marginRight: 6 }} />
                      Reference Size Charts
                    </Text>
                    <Space wrap>
                      {garment.sizeCharts.map((chart) =>
                        chart.url ? (
                          <Tag
                            key={chart.name}
                            color="default"
                            icon={
                              chart.storageKey?.endsWith('.pdf') ? (
                                <FilePdfOutlined />
                              ) : (
                                <FileImageOutlined />
                              )
                            }
                            style={{
                              background: 'rgba(255,255,255,0.06)',
                              border: '1px solid rgba(255,255,255,0.2)',
                              color: 'rgba(255,255,255,0.8)',
                              cursor: 'pointer',
                            }}
                            onClick={() => setChartPreview(chart)}
                          >
                            {chart.name}
                          </Tag>
                        ) : (
                          <Tag
                            key={chart.name}
                            color="default"
                            style={{
                              background: 'rgba(255,255,255,0.04)',
                              border: '1px solid rgba(255,255,255,0.1)',
                              color: 'rgba(255,255,255,0.5)',
                            }}
                          >
                            {chart.name}
                          </Tag>
                        ),
                      )}
                    </Space>
                  </div>
                )}

                <Input
                  value={sizeDraft[garment.id] ?? ''}
                  onChange={(e) =>
                    setSizeDraft((draft) => ({ ...draft, [garment.id]: e.target.value }))
                  }
                  placeholder="Enter your size (for example: XS, S, M, L)"
                  maxLength={64}
                  disabled={locked || savingSizes}
                />
              </div>
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
        </main>
      </div>

      <Modal
        open={!!chartPreview}
        onCancel={() => setChartPreview(null)}
        footer={
          chartPreview?.downloadUrl ? (
            <a
              href={chartPreview.downloadUrl}
              style={{ color: BEASTMODE.accent, fontSize: 14 }}
            >
              Download
            </a>
          ) : null
        }
        title={chartPreview?.name}
        width="80vw"
        styles={{ body: { padding: 0, textAlign: 'center', background: '#111' } }}
        centered
      >
        {chartPreview?.url && (
          chartPreview.storageKey?.endsWith('.pdf') ? (
            <iframe
              src={chartPreview.url}
              style={{ width: '100%', height: '75vh', border: 'none' }}
              title={chartPreview.name}
            />
          ) : (
            <img
              src={chartPreview.url}
              alt={chartPreview.name}
              style={{ maxWidth: '100%', maxHeight: '75vh', objectFit: 'contain' }}
            />
          )
        )}
      </Modal>
    </ConfigProvider>
  );
}
