import { getSession } from '@/lib/session';
import { WorkflowSettingsView } from './WorkflowSettingsView';

export const metadata = { title: 'Workflow settings' };

export default async function WorkflowSettingsPage() {
  const session = await getSession();
  return (
    <div style={{ padding: 24 }}>
      <WorkflowSettingsView role={session.role} />
    </div>
  );
}
