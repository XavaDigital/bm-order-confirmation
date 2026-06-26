'use client';

import Link from 'next/link';
import { Typography, Row, Col, Card, Statistic, Button, Badge, Tag, Space, List, Avatar } from 'antd';
import {
  FileAddOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  SendOutlined,
  EyeOutlined,
  ExclamationCircleOutlined,
  OrderedListOutlined,
  DollarOutlined,
  ArrowRightOutlined,
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

const { Title, Paragraph, Text } = Typography;

const STATUS_COLORS: Record<string, string> = {
  draft: '#8c8c8c',
  sent: '#faad14',
  viewed: '#1677ff',
  confirmed: '#52c41a',
  changes_requested: '#ff4d4f',
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  sent: 'Sent',
  viewed: 'Viewed',
  confirmed: 'Confirmed',
  changes_requested: 'Changes Requested',
};

type RecentOrder = {
  id: string;
  orderNumber: string;
  customerName: string;
  clubName: string | null;
  status: string;
  createdAt: string;
};

interface Props {
  counts: {
    draft: number;
    sent: number;
    viewed: number;
    confirmed: number;
    changesRequested: number;
    total: number;
  };
  totalValueNZD: number;
  trend: Array<{ date: string; label: string; count: number }>;
  recentOrders: RecentOrder[];
}

function formatNZD(value: number) {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function statusTag(status: string) {
  const color = STATUS_COLORS[status] ?? '#8c8c8c';
  return (
    <Tag color={color} style={{ margin: 0, textTransform: 'capitalize' }}>
      {STATUS_LABELS[status] ?? status}
    </Tag>
  );
}

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function DashboardView({ counts, totalValueNZD, trend, recentOrders }: Props) {
  const pieData = [
    { name: 'Draft', value: counts.draft, key: 'draft' },
    { name: 'Sent', value: counts.sent, key: 'sent' },
    { name: 'Viewed', value: counts.viewed, key: 'viewed' },
    { name: 'Confirmed', value: counts.confirmed, key: 'confirmed' },
    { name: 'Changes', value: counts.changesRequested, key: 'changes_requested' },
  ].filter((d) => d.value > 0);

  const awaitingCount = counts.sent + counts.viewed;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <Title level={3} style={{ marginBottom: 4 }}>Dashboard</Title>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            Overview of all order confirmations.
          </Paragraph>
        </div>
        <Link href="/admin/orders/new">
          <Button type="primary" icon={<FileAddOutlined />} size="large">
            New Order
          </Button>
        </Link>
      </div>

      {/* Stat cards */}
      <Row gutter={[16, 16]}>
        <Col xs={12} sm={8} xl={4}>
          <Card styles={{ body: { padding: '16px 20px' } }}>
            <Statistic
              title="Total Orders"
              value={counts.total}
              prefix={<OrderedListOutlined />}
              valueStyle={{ fontWeight: 700 }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} xl={4}>
          <Card styles={{ body: { padding: '16px 20px' } }}>
            <Statistic
              title="Pipeline Value"
              value={formatNZD(totalValueNZD)}
              prefix={<DollarOutlined />}
              valueStyle={{ fontWeight: 700, color: '#1677ff' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} xl={4}>
          <Card styles={{ body: { padding: '16px 20px' } }}>
            <Statistic
              title="Awaiting Customer"
              value={awaitingCount}
              prefix={<SendOutlined />}
              valueStyle={{ color: '#faad14', fontWeight: 700 }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} xl={4}>
          <Card styles={{ body: { padding: '16px 20px' } }}>
            <Statistic
              title="In Progress"
              value={counts.draft}
              prefix={<ClockCircleOutlined />}
              valueStyle={{ fontWeight: 700 }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} xl={4}>
          <Card styles={{ body: { padding: '16px 20px' } }}>
            <Statistic
              title="Confirmed"
              value={counts.confirmed}
              prefix={<CheckCircleOutlined />}
              valueStyle={{ color: '#52c41a', fontWeight: 700 }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} xl={4}>
          <Card styles={{ body: { padding: '16px 20px' } }}>
            <Statistic
              title="Changes Requested"
              value={counts.changesRequested}
              prefix={<ExclamationCircleOutlined />}
              valueStyle={{ color: counts.changesRequested > 0 ? '#ff4d4f' : undefined, fontWeight: 700 }}
            />
          </Card>
        </Col>
      </Row>

      {/* Charts row */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        {/* 7-day trend */}
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

        {/* Status breakdown */}
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
                      <Cell key={entry.key} fill={STATUS_COLORS[entry.key]} />
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
              <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Text type="secondary">No orders yet</Text>
              </div>
            )}
          </Card>
        </Col>
      </Row>

      {/* Bottom row: recent activity + quick actions */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        {/* Recent orders */}
        <Col xs={24} lg={14}>
          <Card
            title="Recent Orders"
            extra={
              <Link href="/admin/orders">
                <Button type="link" size="small" icon={<ArrowRightOutlined />} style={{ padding: 0 }}>
                  View all
                </Button>
              </Link>
            }
            styles={{ body: { padding: 0 } }}
          >
            <List
              dataSource={recentOrders}
              renderItem={(order) => (
                <List.Item
                  style={{ padding: '10px 20px' }}
                  actions={[
                    <Link key="open" href={`/admin/orders/${order.id}`}>
                      <Button type="link" size="small" icon={<EyeOutlined />} style={{ padding: 0 }}>
                        Open
                      </Button>
                    </Link>,
                  ]}
                >
                  <List.Item.Meta
                    avatar={
                      <Avatar
                        style={{
                          backgroundColor: STATUS_COLORS[order.status] + '22',
                          color: STATUS_COLORS[order.status],
                          fontWeight: 700,
                          fontSize: 12,
                        }}
                        size={36}
                      >
                        {order.customerName.charAt(0).toUpperCase()}
                      </Avatar>
                    }
                    title={
                      <Space size={8}>
                        <Text strong style={{ fontSize: 13 }}>{order.customerName}</Text>
                        {order.clubName && <Text type="secondary" style={{ fontSize: 12 }}>{order.clubName}</Text>}
                      </Space>
                    }
                    description={
                      <Space size={8}>
                        <Text style={{ fontSize: 11 }} type="secondary">#{order.orderNumber}</Text>
                        {statusTag(order.status)}
                        <Text style={{ fontSize: 11 }} type="secondary">{timeAgo(order.createdAt)}</Text>
                      </Space>
                    }
                  />
                </List.Item>
              )}
              locale={{ emptyText: 'No orders yet' }}
            />
          </Card>
        </Col>

        {/* Quick actions */}
        <Col xs={24} lg={10}>
          <Card title="Quick Actions" style={{ height: '100%' }}>
            <Space direction="vertical" style={{ width: '100%' }} size={12}>
              <Link href="/admin/orders/new" style={{ display: 'block' }}>
                <Button
                  type="primary"
                  icon={<FileAddOutlined />}
                  block
                  size="large"
                  style={{ textAlign: 'left', height: 'auto', padding: '10px 16px' }}
                >
                  <div>
                    <div style={{ fontWeight: 600 }}>Create New Order</div>
                    <div style={{ fontSize: 12, opacity: 0.8, fontWeight: 400 }}>Start a new customer confirmation</div>
                  </div>
                </Button>
              </Link>

              <Link href="/admin/orders?status=sent" style={{ display: 'block' }}>
                <Button
                  icon={<SendOutlined />}
                  block
                  size="large"
                  style={{ textAlign: 'left', height: 'auto', padding: '10px 16px' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>Awaiting Customer</div>
                      <div style={{ fontSize: 12, opacity: 0.65, fontWeight: 400 }}>Orders sent, pending response</div>
                    </div>
                    {awaitingCount > 0 && (
                      <Badge count={awaitingCount} style={{ backgroundColor: '#faad14' }} />
                    )}
                  </div>
                </Button>
              </Link>

              {counts.changesRequested > 0 && (
                <Link href="/admin/orders?status=changes_requested" style={{ display: 'block' }}>
                  <Button
                    danger
                    icon={<ExclamationCircleOutlined />}
                    block
                    size="large"
                    style={{ textAlign: 'left', height: 'auto', padding: '10px 16px' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 600 }}>Changes Requested</div>
                        <div style={{ fontSize: 12, opacity: 0.8, fontWeight: 400 }}>Customers need attention</div>
                      </div>
                      <Badge count={counts.changesRequested} />
                    </div>
                  </Button>
                </Link>
              )}

              <Link href="/admin/orders" style={{ display: 'block' }}>
                <Button
                  icon={<OrderedListOutlined />}
                  block
                  size="large"
                  style={{ textAlign: 'left', height: 'auto', padding: '10px 16px' }}
                >
                  <div>
                    <div style={{ fontWeight: 600 }}>All Orders</div>
                    <div style={{ fontSize: 12, opacity: 0.65, fontWeight: 400 }}>Browse and manage every order</div>
                  </div>
                </Button>
              </Link>
            </Space>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
