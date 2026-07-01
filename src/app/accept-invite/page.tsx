import { Suspense } from 'react';
import { AcceptInviteView } from './AcceptInviteView';

// useSearchParams in AcceptInviteView requires a Suspense boundary (Next.js App Router).
export default function AcceptInvitePage() {
  return (
    <Suspense fallback={null}>
      <AcceptInviteView />
    </Suspense>
  );
}
