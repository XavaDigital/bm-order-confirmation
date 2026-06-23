import { Suspense } from 'react';
import { LoginForm } from './LoginForm';

// useSearchParams in LoginForm requires a Suspense boundary (Next.js App Router).
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
