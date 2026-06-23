'use client';

import Link from 'next/link';
import { Typography, Row, Col, Card, Statistic, Button, Space } from 'antd';
import {
  FileAddOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  SendOutlined,
} from '@ant-design/icons';

const { Title, Paragraph } = Typography;

interface OrderCounts {
  draft: number;
  sent: number;
  viewed: number;
  confirmed: number;
  total: number;
}

export function DashboardView({ counts }: { counts: OrderCounts }) {
  return (
    <div>
      <div
        style={{
          marginBottom: 24,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
        }}
      >
        <div>
          <Title level={3} style={{ marginBottom: 4 }}>
            Dashboard
          </Title>
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

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <Statistic title="Total Orders" value={counts.total} valueStyle={{ fontWeight: 700 }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <Statistic
              title="Awaiting Customer"
              value={counts.sent + counts.viewed}
              prefix={<SendOutlined />}
              valueStyle={{ color: '#faad14', fontWeight: 700 }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <Statistic
              title="In Progress"
              value={counts.draft}
              prefix={<ClockCircleOutlined />}
              valueStyle={{ fontWeight: 700 }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <Statistic
              title="Confirmed"
              value={counts.confirmed}
              prefix={<CheckCircleOutlined />}
              valueStyle={{ color: '#52c41a', fontWeight: 700 }}
            />
          </Card>
        </Col>
      </Row>

      <Card style={{ marginTop: 24 }}>
        <Space direction="vertical" size={4}>
          <Title level={5} style={{ marginBottom: 0 }}>
            Quick actions
          </Title>
          <Paragraph type="secondary" style={{ marginBottom: 16 }}>
            Get started with today&apos;s work.
          </Paragraph>
        </Space>
        <Space wrap>
          <Link href="/admin/orders/new">
            <Button icon={<FileAddOutlined />}>Create new order</Button>
          </Link>
          <Link href="/admin/orders">
            <Button>View all orders</Button>
          </Link>
        </Space>
      </Card>
    </div>
  );
}
