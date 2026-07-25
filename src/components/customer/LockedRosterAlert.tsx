'use client';

import { Alert } from 'antd';
import { SALES_REP_LABEL } from '@/lib/config';
import { WARNING_SURFACE_STYLE } from './customerStyles';

/** Amber banner shown on both roster pages when the roster has been locked. */
export function LockedRosterAlert() {
  return (
    <Alert
      type="warning"
      showIcon
      message="This roster is locked"
      description={`Please contact your ${SALES_REP_LABEL} if you need any changes.`}
      style={{ marginBottom: 24, ...WARNING_SURFACE_STYLE }}
    />
  );
}
