'use client';

import { ConfigProvider, Typography, Card, Descriptions, Tag } from 'antd';
import { darkTheme } from '@/lib/theme';

const { Title, Paragraph } = Typography;

// Client view for the customer confirmation page. Receives already-fetched,
// already-authorized order data from the server component. The full
// review/acknowledgments/signature/finalize flow is build phase 3.
export type CustomerOrderViewProps = {
  orderNumber: string;
  customerName: string;
  clubName: string | null;
  status: string;
  expectedShipDate: string | null;
  deadlineDate: string | null;
};

export function CustomerOrderView(props: CustomerOrderViewProps) {
  return (
    <ConfigProvider theme={darkTheme}>
      <div
        className="beastmode"
        style={{
          minHeight: '100vh',
          background: '#0B1622',
          color: '#fff',
          padding: '48px 24px',
        }}
      >
        <main style={{ maxWidth: 820, margin: '0 auto' }}>
          <Tag color="red">Order Confirmation</Tag>
          <Title style={{ color: '#fff', marginTop: 12 }}>Confirm your order</Title>
          <Paragraph style={{ color: 'rgba(255,255,255,0.65)' }}>
            Order {props.orderNumber} for {props.customerName}
            {props.clubName ? ` · ${props.clubName}` : ''}
          </Paragraph>

          <Card style={{ marginTop: 24 }}>
            <Descriptions column={1} title="Order summary">
              <Descriptions.Item label="Order number">
                {props.orderNumber}
              </Descriptions.Item>
              <Descriptions.Item label="Status">{props.status}</Descriptions.Item>
              <Descriptions.Item label="Expected ship date">
                {props.expectedShipDate ?? '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Required by">
                {props.deadlineDate ?? '—'}
              </Descriptions.Item>
            </Descriptions>
          </Card>

          <Paragraph style={{ color: 'rgba(255,255,255,0.45)', marginTop: 32 }}>
            (Scaffold) The full experience — mock-up gallery, sizing table, fabrics,
            size-chart links, the 7 acknowledgments, shipping, signature, and the
            finalize action — is implemented in build phase 3.
          </Paragraph>
        </main>
      </div>
    </ConfigProvider>
  );
}
