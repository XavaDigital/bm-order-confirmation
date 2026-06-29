'use client';

import { StopOutlined } from '@ant-design/icons';
import { ConfigProvider, Typography } from 'antd';
import { darkTheme, BEASTMODE, headingFont } from '@/lib/theme';

const { Title, Text, Paragraph } = Typography;

export default function TokenNotFound() {
  return (
    <ConfigProvider theme={darkTheme}>
      <div
        style={{
          minHeight: '100vh',
          background: BEASTMODE.navy,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        }}
      >
        <div style={{ textAlign: 'center', maxWidth: 480 }}>
          <StopOutlined
            style={{ fontSize: 64, color: BEASTMODE.accent, marginBottom: 24 }}
          />
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
            Please contact your BeastMode sales representative to request a new link.
          </Paragraph>
        </div>
      </div>
    </ConfigProvider>
  );
}
