'use client';

import { StopOutlined } from '@ant-design/icons';
import { ConfigProvider, Typography } from 'antd';
import { darkTheme, BEASTMODE, headingFont } from '@/lib/theme';
import { SALES_REP_LABEL } from '@/lib/config';
import { StatusPage } from '@/components/customer/StatusPage';

const { Title, Text, Paragraph } = Typography;

export default function TokenNotFound() {
  return (
    <ConfigProvider theme={darkTheme}>
      <StatusPage icon={<StopOutlined style={{ fontSize: 64, color: BEASTMODE.accent, marginBottom: 24 }} />}>
        <Title
          style={{
            color: '#fff',
            fontSize: 42,
            fontFamily: headingFont,
            fontWeight: 400,
            letterSpacing: 5,
            textTransform: 'uppercase',
            marginBottom: 12,
          }}
        >
          Link Not Found
        </Title>
        <Text
          style={{
            color: 'rgba(255,255,255,0.6)',
            fontSize: 16,
            display: 'block',
            marginBottom: 16,
          }}
        >
          This link is no longer valid or has expired.
        </Text>
        <Paragraph style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13, marginTop: 24 }}>
          Please contact your {SALES_REP_LABEL} to request a new link.
        </Paragraph>
      </StatusPage>
    </ConfigProvider>
  );
}
