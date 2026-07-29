import { WorkflowSettingsView } from './WorkflowSettingsView';

export const metadata = { title: 'Workflow settings' };

export default function WorkflowSettingsPage() {
  return (
    <div style={{ padding: 24 }}>
      <WorkflowSettingsView />
    </div>
  );
}
