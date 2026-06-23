'use client';

import { Typography, Card, Space, Tag } from 'antd';

const { Title, Paragraph, Text } = Typography;

// Admin landing stub. Real sales portal (auth, order list, order builder) comes
// in build phase 2 (PROJECT_BRIEF.md §12). This just proves the stack is wired.
export default function Home() {
  return (
    <main style={{ maxWidth: 880, margin: '0 auto', padding: '48px 24px' }}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div>
          <Tag color="red">Scaffold</Tag>
          <Title level={1} style={{ marginTop: 12 }}>
            BeastMode Order Confirmation
          </Title>
          <Paragraph type="secondary">
            Internal admin portal (sales side). This is a foundation scaffold — see{' '}
            <Text code>PROJECT_BRIEF.md</Text> for scope and build phases.
          </Paragraph>
        </div>

        <Card title="What's wired up">
          <ul>
            <li>Next.js (App Router) + Ant Design + TypeScript</li>
            <li>Postgres schema via Drizzle (namespaced under the <Text code>confirmation</Text> schema)</li>
            <li>
              Order ingestion seam: <Text code>POST /api/orders</Text> (the future platform&apos;s
              integration point)
            </li>
            <li>Domain-event outbox + magic-link token generation</li>
            <li>noindex everywhere (headers, middleware, robots.txt)</li>
          </ul>
        </Card>

        <Card title="Next steps (build phase 2+)">
          <ul>
            <li>Staff auth (sales/admin roles)</li>
            <li>Order builder UI consuming <Text code>/api/orders</Text></li>
            <li>Customer confirmation page at <Text code>/o/[token]</Text></li>
            <li>File uploads (mock-ups, signatures) to object storage</li>
            <li>Google Ads conversion as the first <Text code>order.confirmed</Text> consumer</li>
          </ul>
        </Card>
      </Space>
    </main>
  );
}
