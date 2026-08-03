import { Suspense } from 'react';
import { Alert } from 'antd';
import { LoginForm } from './LoginForm';
import { GoogleSignIn } from './GoogleSignIn';
import { DifferentAccountLink } from './DifferentAccountLink';
import { AuthCard } from '@/components/auth/AuthCard';
import { AuthHeading } from '@/components/auth/AuthHeading';
import { APP_DISPLAY_NAME } from '@/lib/config';
import { env } from '@/lib/env';
import { isIdentityConfigured } from '@/server/identity/client';

/**
 * Why the admin layout bounced them back here. Two of these mean genuinely
 * different things and must not be collapsed into one message: having no role
 * is not the same as not being a recognised person.
 */
const DENIED_MESSAGES: Record<string, string> = {
  no_access: "You don't have access to BM Orders. Ask an admin to give you access.",
  disabled: 'This account has been disabled.',
  gone: 'This account no longer exists.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const { denied } = await searchParams;
  // Read on the server and passed down, rather than a NEXT_PUBLIC_ inline: the
  // client id is public, but this keeps env.ts the single validated source and
  // means switching the seam on is a restart, not a rebuild.
  const ssoActive = isIdentityConfigured();
  const clientId = ssoActive ? env.GOOGLE_LOGIN_CLIENT_ID : '';
  const deniedMessage = denied ? DENIED_MESSAGES[denied] : null;

  /**
   * The card shell lives HERE rather than inside `LoginForm`. It used to belong
   * to the form, so hiding the form under SSO also removed the branding, the
   * centering and the page background — leaving a bare Google button at the top
   * of a white page.
   */
  return (
    <AuthCard>
      <AuthHeading title={APP_DISPLAY_NAME} subtitle="Sign in to your account" />

      {deniedMessage && (
        <Alert type="warning" showIcon message={deniedMessage} style={{ marginBottom: 24 }} />
      )}

      <Suspense fallback={null}>
        <GoogleSignIn clientId={clientId} showDivider={false} />
        {/* Password sign-in is refused server-side once identity is configured
            (it is a second door identity cannot revoke), so the form is hidden
            rather than left to fail on submit. It reappears wherever the seam is
            switched off — local dev and standalone deployments. */}
        {!ssoActive && <LoginForm />}
      </Suspense>

      {deniedMessage && ssoActive && (
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <DifferentAccountLink />
        </div>
      )}
    </AuthCard>
  );
}

// Tab title: "OrderFlow - Sign In" (root layout template).
export const metadata = { title: 'Sign In' };
