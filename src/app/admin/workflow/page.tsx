import { Typography } from 'antd';
import { WorkflowBoard } from '@/components/admin/workflow/WorkflowBoard';

export const metadata = { title: 'Workflow Board' };

/**
 * The Kanban view over orders and purchase orders.
 *
 * A server component that renders the client board — the board fetches its own
 * data so switching between the two boards, and refreshing after a move, does
 * not need a navigation.
 */
export default function WorkflowPage() {
  return (
    <div style={{ padding: 24 }}>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        Workflow
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginTop: -8 }}>
        Drag a card to move it. Moves that the order or purchase-order lifecycle
        does not allow are refused with a reason.
      </Typography.Paragraph>
      <WorkflowBoard />
    </div>
  );
}
