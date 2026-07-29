'use client';

/**
 * Google sign-in, delegated to the fleet identity service.
 *
 * Uses Google Identity Services directly rather than a wrapper library: the
 * whole integration is one script, one `initialize`, and one `renderButton`, and
 * the credential it hands back goes straight to our own route. A library would
 * be more code to keep current for no behaviour we need.
 *
 * Renders nothing when `clientId` is absent, so the login page is unchanged on a
 * server where the identity seam is switched off.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Divider, Space, Spin } from 'antd';
import { ApiError, postJson } from '@/lib/api-fetch';
import { goAfterAuth } from '@/lib/post-auth-redirect';

interface Props {
  /** This app's Google OAuth client id. Empty = the seam is off. */
  clientId: string;
  /** Where to go after a successful sign-in. */
  next?: string;
  /** Show the "or" divider — only meaningful when something follows it. */
  showDivider?: boolean;
}

interface GoogleCredentialResponse {
  credential?: string;
}

/** The slice of the GIS global we actually use. */
interface GoogleAccountsId {
  initialize: (config: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
    auto_select?: boolean;
  }) => void;
  renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleAccountsId } };
  }
}

const GIS_SRC = 'https://accounts.google.com/gsi/client';

export function GoogleSignIn({ clientId, next, showDivider = false }: Props) {
  const buttonRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const onCredential = useCallback(
    async (response: GoogleCredentialResponse) => {
      if (!response.credential) return;
      setError(null);
      // Verifying the credential and loading the dashboard takes a moment, and
      // Google's button gives no feedback of its own — without this the screen
      // just goes blank and looks broken. Deliberately NOT cleared on success:
      // the spinner should stay up until the navigation actually happens.
      setSubmitting(true);
      try {
        await postJson('/api/auth/google', { credential: response.credential }, 'Sign-in failed');
        goAfterAuth(next);
      } catch (err) {
        setSubmitting(false);
        // The server distinguishes "no grant for this app" from "that did not
        // work"; show its words rather than a generic failure, because they send
        // the person to different places for help.
        setError(
          err instanceof ApiError || err instanceof Error
            ? err.message
            : 'Sign-in failed. Please try again.',
        );
      }
    },
    [next],
  );

  useEffect(() => {
    if (!clientId) return;

    function init() {
      const id = window.google?.accounts?.id;
      if (!id || !buttonRef.current) return;
      id.initialize({
        client_id: clientId,
        callback: (response) => void onCredential(response),
        // No One Tap auto-select: on a shared machine that silently signs in
        // whoever used it last.
        auto_select: false,
      });
      id.renderButton(buttonRef.current, {
        theme: 'outline',
        size: 'large',
        width: 320,
        text: 'signin_with',
      });
      setReady(true);
    }

    if (window.google?.accounts?.id) {
      init();
      return;
    }

    // Reuse the tag if another mount already added it, so a remount does not
    // stack script elements.
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', init, { once: true });
      return () => existing.removeEventListener('load', init);
    }

    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', init, { once: true });
    script.addEventListener('error', () =>
      setError('Could not reach Google sign-in. Use your email and password below.'),
    );
    document.head.appendChild(script);
  }, [clientId, onCredential]);

  if (!clientId) return null;

  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      {error && <Alert type="error" showIcon message={error} />}
      {submitting && (
        // No `tip`: antd renders it inside the spinner's own narrow box, so the
        // label wrapped to one word per line. The spinner alone reads fine.
        <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0' }}>
          <Spin />
        </div>
      )}
      <div
        ref={buttonRef}
        // Labelled so the button is findable before Google has painted into it.
        role="group"
        aria-label="Sign in with Google"
        style={{
          // Kept mounted while submitting rather than unmounted: Google painted
          // into this node, and tearing it out would leave the ref dangling.
          display: submitting ? 'none' : 'flex',
          justifyContent: 'center',
          minHeight: ready ? undefined : 40,
        }}
      />
      {showDivider && (
        <Divider plain style={{ margin: '4px 0' }}>
          or
        </Divider>
      )}
    </Space>
  );
}
