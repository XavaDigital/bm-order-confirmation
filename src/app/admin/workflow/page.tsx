import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
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
      <AdminPageHeader
        title="Workflow"
        subtitle="Drag a card to move it. Moves that the order or purchase-order lifecycle does not allow are refused with a reason."
      />
      <WorkflowBoard />
    </div>
  );
}
