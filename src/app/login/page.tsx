import { Suspense } from 'react';
import { LoginForm } from './LoginForm';
import { GoogleSignIn } from './GoogleSignIn';
import { env } from '@/lib/env';
import { isIdentityConfigured } from '@/server/identity/client';

// useSearchParams in LoginForm requires a Suspense boundary (Next.js App Router).
export default function LoginPage() {
  // Read on the server and passed down, rather than a NEXT_PUBLIC_ inline: the
  // client id is public, but this keeps env.ts the single validated source and
  // means switching the seam on is a restart, not a rebuild.
  const clientId = isIdentityConfigured() ? env.GOOGLE_LOGIN_CLIENT_ID : '';

  return (
    <Suspense fallback={null}>
      <GoogleSignIn clientId={clientId} />
      <LoginForm />
    </Suspense>
  );
}
