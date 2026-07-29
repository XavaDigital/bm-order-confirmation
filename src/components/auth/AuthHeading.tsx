'use client';

import { Typography } from 'antd';

const { Title, Text } = Typography;

interface AuthHeadingProps {
  title: string;
  subtitle?: string;
}

/**
 * Heading for the standalone auth pages.
 *
 * This exists as a CLIENT component on purpose. antd ships its components with
 * `'use client'`, so a server component may import a top-level named export
 * (`Alert`) but must not reach into a compound one: `Typography.Title` is a
 * property access on a client reference, which is `undefined` at render time
 * and fails with "Element type is invalid". Destructuring it here, behind the
 * client boundary, is what makes it a real component again.
 */
export function AuthHeading({ title, subtitle }: AuthHeadingProps) {
  return (
    <div style={{ textAlign: 'center', marginBottom: 32 }}>
      <Title level={2} style={{ marginBottom: 4 }}>
        {title}
      </Title>
      {subtitle && <Text type="secondary">{subtitle}</Text>}
    </div>
  );
}
