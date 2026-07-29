/**
 * Where to go once a sign-in has succeeded, and how to get there.
 *
 * Used by every auth entry point: password login, Google sign-in, and 2FA
 * verification.
 */

/**
 * A redirect target that is safe to navigate to.
 *
 * Anything that is not a plain in-app path becomes the dashboard. Note the
 * `//` check: a protocol-relative URL like `//evil.example` passes a naive
 * `startsWith('/')` test but navigates OFF-SITE, which is an open redirect —
 * and `from` arrives straight from the query string, so it is attacker-chosen.
 */
export function safeNextPath(candidate: string | null | undefined): string {
  if (!candidate) return '/admin/dashboard';
  if (!candidate.startsWith('/')) return '/admin/dashboard';
  if (candidate.startsWith('//')) return '/admin/dashboard';
  return candidate;
}

/**
 * Navigate after a successful sign-in.
 *
 * This is a FULL document load, deliberately not `router.push()`. The session
 * cookie was set by the response we just awaited, but the client router may
 * already hold an RSC entry for the destination fetched while the user was
 * still signed out — so the push renders that empty/stale entry and the screen
 * just goes blank until a manual refresh. Pairing push with `router.refresh()`
 * does not fix it either; the two race.
 *
 * A hard navigation throws the router cache away and lets the server render
 * the admin layout — including its `checkAccess` call — against the new cookie.
 * One reload at sign-in is a fair price for that being reliable.
 */
export function goAfterAuth(candidate?: string | null): void {
  window.location.assign(safeNextPath(candidate));
}
