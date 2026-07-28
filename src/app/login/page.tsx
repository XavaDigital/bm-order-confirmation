import { Suspense } from 'react';
import { Alert } from 'antd';
import { LoginForm } from './LoginForm';
import { GoogleSignIn } from './GoogleSignIn';
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
  const clientId = isIdentityConfigured() ? env.GOOGLE_LOGIN_CLIENT_ID : '';
  const deniedMessage = denied ? DENIED_MESSAGES[denied] : null;

  return (
    <Suspense fallback={null}>
      {deniedMessage && (
        <Alert type="warning" showIcon message={deniedMessage} style={{ marginBottom: 12 }} />
      )}
      <GoogleSignIn clientId={clientId} />
      <LoginForm />
    </Suspense>
  );
}
