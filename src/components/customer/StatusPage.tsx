import { BEASTMODE } from '@/lib/theme';

interface StatusPageProps {
  icon: React.ReactNode;
  maxWidth?: number;
  children: React.ReactNode;
}

/**
 * Full-page centered message shell shared by the customer-facing "terminal"
 * states — confirmed, changes requested, already confirmed, link not found.
 */
export function StatusPage({ icon, maxWidth = 480, children }: StatusPageProps) {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: BEASTMODE.navy,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div style={{ textAlign: 'center', maxWidth }}>
        {icon}
        {children}
      </div>
    </div>
  );
}
