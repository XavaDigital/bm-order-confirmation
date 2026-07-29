'use client';

import type { StaffRole } from '@/lib/roles';
import { Typography, Row, Col, Card, Statistic } from 'antd';
import {
  ClockCircleOutlined,
  CheckCircleOutlined,
  SendOutlined,
  ExclamationCircleOutlined,
  OrderedListOutlined,
  DollarOutlined,
  BgColorsOutlined,
  ThunderboltOutlined,
  RiseOutlined,
  FieldTimeOutlined,
} from '@ant-design/icons';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { orderStatusMeta, poStatusMeta } from '@/lib/status';
import { SEMANTIC } from '@/lib/semantic-colors';
import { BRAND } from '@/lib/theme';

const { Text, Title } = Typography;

interface Props {
  counts: {
    draft: number;
    sent: number;
    viewed: number;
    confirmed: number;
    changesRequested: number;
    cancelled: number;
    total: number;
  };
  totalValueNZD: number;
  avgOrderValueNZD: number;
  confirmationRatePct: number;
  avgTimeToConfirmDays: number | null;
  trend: Array<{ date: string; label: string; count: number }>;
  colorSampleHoldsCount: number;
  role: StaffRole;
  failedEventsCount: number;
  deadFailedEventsCount: number;
  timeToConfirmBuckets: Array<{ bucket: string; count: number }>;
  pipelineValueTrend: Array<{ week: string; label: string; valueNZD: number }>;
  topClubs: Array<{ club: string; count: number }>;
  poStatusCounts: Array<{ status: string; count: number }>;
  garmentTypePopularity: Array<{ name: string; count: number }>;
}

function formatNZD(value: number) {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function EmptyChart({ text }: { text: string }) {
  return (
    <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Text type="secondary">{text}</Text>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Title level={5} style={{ margin: '24px 0 12px' }}>
      {children}
    </Title>
  );
}

export function MetricsView({
  counts,
  totalValueNZD,
  avgOrderValueNZD,
  confirmationRatePct,
  avgTimeToConfirmDays,
  trend,
  colorSampleHoldsCount,
  role,
  failedEventsCount,
  deadFailedEventsCount,
  timeToConfirmBuckets,
  pipelineValueTrend,
  topClubs,
  poStatusCounts,
  garmentTypePopularity,
}: Props) {
  const pieData = [
    { name: 'Draft', value: counts.draft, key: 'draft' },
    { name: 'Sent', value: counts.sent, key: 'sent' },
    { name: 'Viewed', value: counts.viewed, key: 'viewed' },
    { name: 'Confirmed', value: counts.confirmed, key: 'confirmed' },
    { name: 'Changes', value: counts.changesRequested, key: 'changes_requested' },
    { name: 'Cancelled', value: counts.cancelled, key: 'cancelled' },
  ].filter((d) => d.value > 0);

  const awaitingCount = counts.sent + counts.viewed;
  const hasConfirmedOrders = timeToConfirmBuckets.some((b) => b.count > 0);
  const hasPipelineValueHistory = pipelineValueTrend.some((w) => w.valueNZD > 0);
  const hasClubs = topClubs.length > 0;
  const hasPoData = poStatusCounts.length > 0;
  const hasGarmentTypeData = garmentTypePopularity.length > 0;

  return (
    <div>
      <AdminPageHeader title="Metrics" subtitle="Reporting on all order confirmations." />

      {/* Stat cards */}
      <Row gutter={[16, 16]}>
        <Col xs={12} sm={8} xl={{ flex: 1 }}>
          <Card styles={{ body: { padding: '16px 20px' } }}>
            <Statistic
              title="Total Orders"
              value={counts.total}
              prefix={<OrderedListOutlined />}
              valueStyle={{ fontWeight: 700 }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} xl={{ flex: 1 }}>
          <Card styles={{ body: { padding: '16px 20px' } }}>
            <Statistic
              title="Pipeline Value"
              value={formatNZD(totalValueNZD)}
              prefix={<DollarOutlined />}
              valueStyle={{ fontWeight: 700, color: SEMANTIC.info }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} xl={{ flex: 1 }}>
          <Card styles={{ body: { padding: '16px 20px' } }}>
            <Statistic
              title="Awaiting Customer"
              value={awaitingCount}
              prefix={<SendOutlined />}
              valueStyle={{ color: SEMANTIC.warning, fontWeight: 700 }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} xl={{ flex: 1 }}>
          <Card styles={{ body: { padding: '16px 20px' } }}>
            <Statistic
              title="In Progress"
              value={counts.draft}
              prefix={<ClockCircleOutlined />}
              valueStyle={{ fontWeight: 700 }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} xl={{ flex: 1 }}>
          <Card styles={{ body: { padding: '16px 20px' } }}>
            <Statistic
              title="Confirmed"
              value={counts.confirmed}
              prefix={<CheckCircleOutlined />}
              valueStyle={{ color: SEMANTIC.success, fontWeight: 700 }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} xl={{ flex: 1 }}>
          <Card styles={{ body: { padding: '16px 20px' } }}>
            <Statistic
              title="Changes Requested"
              value={counts.changesRequested}
              prefix={<ExclamationCircleOutlined />}
              valueStyle={{ color: counts.changesRequested > 0 ? SEMANTIC.error : undefined, fontWeight: 700 }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} xl={{ flex: 1 }}>
          <Card styles={{ body: { padding: '16px 20px' } }}>
            <Statistic
              title="Colour Sample Holds"
              value={colorSampleHoldsCount}
              prefix={<BgColorsOutlined />}
              valueStyle={{ color: colorSampleHoldsCount > 0 ? SEMANTIC.hold : undefined, fontWeight: 700 }}
            />
          </Card>
        </Col>
        {role === 'admin' && (
          <Col xs={12} sm={8} xl={{ flex: 1 }}>
            <Card styles={{ body: { padding: '16px 20px' } }}>
              <Statistic
                title="Failed Events"
                value={failedEventsCount}
                prefix={<ThunderboltOutlined />}
                valueStyle={{ color: failedEventsCount > 0 ? SEMANTIC.error : undefined, fontWeight: 700 }}
                suffix={
                  deadFailedEventsCount > 0 ? (
                    <Text style={{ fontSize: 12 }} type="secondary">({deadFailedEventsCount} dead)</Text>
                  ) : undefined
                }
              />
            </Card>
          </Col>
        )}
      </Row>

      {/* Secondary at-a-glance stats: averages/rates derived from the counts above */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={12} sm={8}>
          <Card styles={{ body: { padding: '16px 20px' } }}>
            <Statistic
              title="Average Order Value"
              value={formatNZD(avgOrderValueNZD)}
              prefix={<DollarOutlined />}
              valueStyle={{ fontWeight: 700, color: SEMANTIC.info }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8}>
          <Card styles={{ body: { padding: '16px 20px' } }}>
            <Statistic
              title="Confirmation Rate"
              value={confirmationRatePct}
              precision={0}
              suffix="%"
              prefix={<RiseOutlined />}
              valueStyle={{ fontWeight: 700, color: SEMANTIC.success }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8}>
          <Card styles={{ body: { padding: '16px 20px' } }}>
            <Statistic
              title="Avg. Time to Confirm"
              value={avgTimeToConfirmDays !== null ? avgTimeToConfirmDays.toFixed(1) : '—'}
              suffix={avgTimeToConfirmDays !== null ? 'days' : undefined}
              prefix={<FieldTimeOutlined />}
              valueStyle={{ fontWeight: 700 }}
            />
          </Card>
        </Col>
      </Row>

      {/* --- Sales --- */}
      <SectionTitle>Sales</SectionTitle>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card
            title="Orders — Last 7 Days"
            styles={{ body: { padding: '8px 16px 16px' } }}
          >
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={trend} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip
                  formatter={(v) => [v, 'Orders']}
                  contentStyle={{ borderRadius: 6, fontSize: 12 }}
                />
                <Bar dataKey="count" fill="#cc0000" radius={[4, 4, 0, 0]} maxBarSize={48} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card title="Status Breakdown" styles={{ body: { padding: '8px 16px 16px' } }}>
            {pieData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={52}
                    outerRadius={80}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {pieData.map((entry) => (
                      <Cell key={entry.key} fill={orderStatusMeta(entry.key).hex} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v, name) => [v, name]}
                    contentStyle={{ borderRadius: 6, fontSize: 12 }}
                  />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: 12 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart text="No orders yet" />
            )}
          </Card>
        </Col>

        <Col xs={24}>
          <Card title="Pipeline Value — Last 8 Weeks" styles={{ body: { padding: '8px 16px 16px' } }}>
            {hasPipelineValueHistory ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={pipelineValueTrend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => formatNZD(v)}
                  />
                  <Tooltip
                    formatter={(v) => [formatNZD(Number(v)), 'Value']}
                    contentStyle={{ borderRadius: 6, fontSize: 12 }}
                  />
                  <Bar dataKey="valueNZD" fill={SEMANTIC.info} radius={[4, 4, 0, 0]} maxBarSize={48} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart text="No order value recorded in the last 8 weeks" />
            )}
          </Card>
        </Col>
      </Row>

      {/* --- Conversion --- */}
      <SectionTitle>Conversion</SectionTitle>
      <Row gutter={[16, 16]}>
        <Col xs={24}>
          <Card title="Time to Confirm" styles={{ body: { padding: '8px 16px 16px' } }}>
            {hasConfirmedOrders ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={timeToConfirmBuckets} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <XAxis dataKey="bucket" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    formatter={(v) => [v, 'Orders']}
                    contentStyle={{ borderRadius: 6, fontSize: 12 }}
                  />
                  <Bar dataKey="count" fill={SEMANTIC.viewed} radius={[4, 4, 0, 0]} maxBarSize={48} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart text="No confirmed orders yet" />
            )}
          </Card>
        </Col>
      </Row>

      {/* --- Customers --- */}
      <SectionTitle>Customers</SectionTitle>
      <Row gutter={[16, 16]}>
        <Col xs={24}>
          <Card title="Top Clubs — by Order Count" styles={{ body: { padding: '8px 16px 16px' } }}>
            {hasClubs ? (
              <ResponsiveContainer width="100%" height={Math.max(200, topClubs.length * 36)}>
                <BarChart
                  data={topClubs}
                  layout="vertical"
                  margin={{ top: 4, right: 16, left: 8, bottom: 0 }}
                >
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis
                    type="category"
                    dataKey="club"
                    width={140}
                    tick={{ fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    formatter={(v) => [v, 'Orders']}
                    contentStyle={{ borderRadius: 6, fontSize: 12 }}
                  />
                  <Bar dataKey="count" fill={BRAND.primary} radius={[0, 4, 4, 0]} maxBarSize={20} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart text="No orders to rank yet" />
            )}
          </Card>
        </Col>
      </Row>

      {/* --- Production & Fulfillment --- */}
      <SectionTitle>Production &amp; Fulfillment</SectionTitle>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title="Purchase Order Status" styles={{ body: { padding: '8px 16px 16px' } }}>
            {hasPoData ? (
              <ResponsiveContainer width="100%" height={Math.max(200, poStatusCounts.length * 32)}>
                <BarChart
                  data={poStatusCounts.map((r) => ({ ...r, label: poStatusMeta(r.status).label }))}
                  layout="vertical"
                  margin={{ top: 4, right: 16, left: 8, bottom: 0 }}
                >
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={110}
                    tick={{ fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    formatter={(v) => [v, 'Purchase Orders']}
                    contentStyle={{ borderRadius: 6, fontSize: 12 }}
                  />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={20}>
                    {poStatusCounts.map((entry) => (
                      <Cell key={entry.status} fill={poStatusMeta(entry.status).hex} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart text="No purchase orders yet" />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card title="Garment Type Popularity" styles={{ body: { padding: '8px 16px 16px' } }}>
            {hasGarmentTypeData ? (
              <ResponsiveContainer width="100%" height={Math.max(200, garmentTypePopularity.length * 32)}>
                <BarChart
                  data={garmentTypePopularity}
                  layout="vertical"
                  margin={{ top: 4, right: 16, left: 8, bottom: 0 }}
                >
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={110}
                    tick={{ fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    formatter={(v) => [v, 'Garments']}
                    contentStyle={{ borderRadius: 6, fontSize: 12 }}
                  />
                  <Bar dataKey="count" fill={SEMANTIC.duplicate} radius={[0, 4, 4, 0]} maxBarSize={20} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart text="No typed garments yet" />
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
