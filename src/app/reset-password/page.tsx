import { Suspense } from 'react';
import { ResetPasswordView } from './ResetPasswordView';

// useSearchParams in ResetPasswordView requires a Suspense boundary (Next.js App Router).
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordView />
    </Suspense>
  );
}
