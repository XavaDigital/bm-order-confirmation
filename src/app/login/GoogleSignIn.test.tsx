import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { GoogleSignIn } from './GoogleSignIn';

const pushMock = vi.fn();
const refreshMock = vi.fn();
// vi.hoisted because the factory below dereferences this immediately, unlike
// the useRouter mock whose arrow function defers until render.
const goAfterAuthMock = vi.hoisted(() => vi.fn());

// Sign-in navigates with a real document load — see src/lib/post-auth-redirect.ts.
// This component's contract is to hand over the destination; the refusal of
// off-site targets is proven in post-auth-redirect.test.ts.
vi.mock('@/lib/post-auth-redirect', () => ({ goAfterAuth: goAfterAuthMock }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

vi.mock('@/lib/api-fetch', () => ({
  postJson: vi.fn(),
  getJson: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status = 500) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
    }
  },
}));

import { postJson } from '@/lib/api-fetch';

const CLIENT_ID = '414540960371-dpqln2dcb5o97d9sr75s8o22ato4j7lu.apps.googleusercontent.com';

/** Captures what the component hands to Google Identity Services. */
function installGis() {
  const initialize = vi.fn();
  const renderButton = vi.fn();
  (window as unknown as { google: unknown }).google = { accounts: { id: { initialize, renderButton } } };
  return { initialize, renderButton };
}

/** Fire the callback the component registered, as Google would. */
function signInWith(initialize: ReturnType<typeof vi.fn>, credential: string) {
  const config = initialize.mock.calls[0][0] as {
    callback: (r: { credential?: string }) => void;
  };
  config.callback({ credential });
}

beforeEach(() => {
  pushMock.mockClear();
  refreshMock.mockClear();
  goAfterAuthMock.mockClear();
  vi.mocked(postJson).mockReset().mockResolvedValue({ ok: true });
  document.head.querySelectorAll('script').forEach((s) => s.remove());
});

afterEach(() => {
  delete (window as unknown as { google?: unknown }).google;
});

describe('GoogleSignIn — dormant', () => {
  // The login page must be visually unchanged where the seam is switched off.
  it('renders nothing without a client id', () => {
    const { container } = render(<GoogleSignIn clientId="" />);

    expect(container).toBeEmptyDOMElement();
  });

  it('loads no Google script without a client id', () => {
    render(<GoogleSignIn clientId="" />);

    expect(document.querySelector('script[src*="accounts.google.com"]')).toBeNull();
  });
});

describe('GoogleSignIn — setup', () => {
  it('initialises with this app’s client id', async () => {
    const { initialize } = installGis();
    render(<GoogleSignIn clientId={CLIENT_ID} />);

    await waitFor(() => expect(initialize).toHaveBeenCalled());
    expect(initialize.mock.calls[0][0]).toMatchObject({ client_id: CLIENT_ID });
  });

  // On a shared machine, auto-select silently signs in whoever used it last.
  it('disables One Tap auto-select', async () => {
    const { initialize } = installGis();
    render(<GoogleSignIn clientId={CLIENT_ID} />);

    await waitFor(() => expect(initialize).toHaveBeenCalled());
    expect(initialize.mock.calls[0][0]).toMatchObject({ auto_select: false });
  });

  it('renders the button into its own container', async () => {
    const { renderButton } = installGis();
    render(<GoogleSignIn clientId={CLIENT_ID} />);

    await waitFor(() => expect(renderButton).toHaveBeenCalled());
    expect(renderButton.mock.calls[0][0]).toBeInstanceOf(HTMLElement);
  });

  it('injects the Google script when it is not already present', () => {
    render(<GoogleSignIn clientId={CLIENT_ID} />);

    expect(document.querySelector('script[src="https://accounts.google.com/gsi/client"]')).not.toBeNull();
  });

  // A remount must not stack script tags.
  it('reuses an existing script tag', () => {
    const { unmount } = render(<GoogleSignIn clientId={CLIENT_ID} />);
    unmount();
    render(<GoogleSignIn clientId={CLIENT_ID} />);

    expect(document.querySelectorAll('script[src="https://accounts.google.com/gsi/client"]')).toHaveLength(1);
  });
});

describe('GoogleSignIn — signing in', () => {
  it('posts the credential and navigates on success', async () => {
    const { initialize } = installGis();
    render(<GoogleSignIn clientId={CLIENT_ID} />);
    await waitFor(() => expect(initialize).toHaveBeenCalled());

    signInWith(initialize, 'google-id-token');

    await waitFor(() =>
      expect(postJson).toHaveBeenCalledWith(
        '/api/auth/google',
        { credential: 'google-id-token' },
        expect.any(String),
      ),
    );
    await waitFor(() => expect(goAfterAuthMock).toHaveBeenCalled());
  });

  it('honours a relative next destination', async () => {
    const { initialize } = installGis();
    render(<GoogleSignIn clientId={CLIENT_ID} next="/admin/orders" />);
    await waitFor(() => expect(initialize).toHaveBeenCalled());

    signInWith(initialize, 'token');

    await waitFor(() => expect(goAfterAuthMock).toHaveBeenCalledWith('/admin/orders'));
  });

  /**
   * An open redirect would let a phishing link bounce someone off-site straight
   * after a successful sign-in. The component forwards the destination
   * unexamined and `goAfterAuth` is the single place that decides — so what is
   * asserted here is that nothing else navigates behind its back. The refusal
   * itself is covered, across seven off-site forms, in
   * src/lib/post-auth-redirect.test.ts.
   */
  it('routes an absolute next destination through the redirect guard', async () => {
    const { initialize } = installGis();
    render(<GoogleSignIn clientId={CLIENT_ID} next="https://evil.test/steal" />);
    await waitFor(() => expect(initialize).toHaveBeenCalled());

    signInWith(initialize, 'token');

    await waitFor(() => expect(goAfterAuthMock).toHaveBeenCalledWith('https://evil.test/steal'));
    // Nothing navigates behind the guard's back.
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('ignores a callback with no credential', async () => {
    const { initialize } = installGis();
    render(<GoogleSignIn clientId={CLIENT_ID} />);
    await waitFor(() => expect(initialize).toHaveBeenCalled());

    const config = initialize.mock.calls[0][0] as { callback: (r: object) => void };
    config.callback({});

    expect(postJson).not.toHaveBeenCalled();
  });

  /**
   * The server distinguishes "you have no grant for this app" from "that did not
   * work"; the UI must show its words, because the two send people to different
   * places for help.
   */
  it('shows the server’s reason rather than a generic failure', async () => {
    const { initialize } = installGis();
    vi.mocked(postJson).mockRejectedValue(
      new Error('Your account does not have access to the order portal yet. Ask an admin to grant it.'),
    );
    render(<GoogleSignIn clientId={CLIENT_ID} />);
    await waitFor(() => expect(initialize).toHaveBeenCalled());

    signInWith(initialize, 'token');

    expect(await screen.findByText(/ask an admin to grant it/i)).toBeInTheDocument();
    expect(goAfterAuthMock).not.toHaveBeenCalled();
  });

  it('does not navigate when sign-in fails', async () => {
    const { initialize } = installGis();
    vi.mocked(postJson).mockRejectedValue(new Error('nope'));
    render(<GoogleSignIn clientId={CLIENT_ID} />);
    await waitFor(() => expect(initialize).toHaveBeenCalled());

    signInWith(initialize, 'token');

    await screen.findByText('nope');
    expect(goAfterAuthMock).not.toHaveBeenCalled();
  });
});
