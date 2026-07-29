import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginForm } from './LoginForm';

const pushMock = vi.fn();
const refreshMock = vi.fn();
// vi.hoisted because the factory below dereferences this immediately, unlike
// the useRouter mock whose arrow function defers until render.
const goAfterAuthMock = vi.hoisted(() => vi.fn());
let searchParamsValue = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
  useSearchParams: () => searchParamsValue,
}));

// Signing in navigates with a real document load, not router.push — see
// src/lib/post-auth-redirect.ts. The form's job is to hand over the raw `from`
// value; validating it is the helper's, and post-auth-redirect.test.ts covers
// the off-site cases.
vi.mock('@/lib/post-auth-redirect', () => ({ goAfterAuth: goAfterAuthMock }));

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>, email = 'jane@example.com', password = 'hunter2') {
  await user.type(screen.getByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: /sign in/i }));
}

beforeEach(() => {
  pushMock.mockClear();
  refreshMock.mockClear();
  goAfterAuthMock.mockClear();
  searchParamsValue = new URLSearchParams();
  vi.stubGlobal('fetch', vi.fn());
});

describe('LoginForm', () => {
  // The card shell, app name and subtitle belong to the PAGE, not to this form:
  // the form is hidden once identity is configured, and when it owned the card
  // it took the branding and the page styling down with it.
  it('renders both fields, and no card shell of its own', () => {
    render(<LoginForm />);

    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.queryByText('BeastMode')).not.toBeInTheDocument();
    expect(screen.queryByText('Sign in to your account')).not.toBeInTheDocument();
  });

  it('shows validation errors when submitting an empty form', async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText('Enter your email')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a successful login with no MFA required redirects to the dashboard and refreshes', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ requiresMfa: false }),
    } as Response);
    render(<LoginForm />);

    await fillAndSubmit(user);

    expect(fetch).toHaveBeenCalledWith('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'jane@example.com', password: 'hunter2' }),
    });
    await vi.waitFor(() => expect(goAfterAuthMock).toHaveBeenCalledWith(null));
  });

  it('redirects to the "from" URL search param when present', async () => {
    searchParamsValue = new URLSearchParams('from=/admin/orders');
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ requiresMfa: false }) } as Response);
    render(<LoginForm />);

    await fillAndSubmit(user);

    await vi.waitFor(() => expect(goAfterAuthMock).toHaveBeenCalledWith('/admin/orders'));
  });

  it('redirects to the 2FA challenge instead when the account requires MFA', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ requiresMfa: true }) } as Response);
    render(<LoginForm />);

    await fillAndSubmit(user);

    // The 2FA challenge is NOT behind the admin layout and the session is only
    // half-established, so this one stays a client-side push.
    await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith('/login/2fa'));
    expect(goAfterAuthMock).not.toHaveBeenCalled();
  });

  it('shows the server error message when login fails', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Invalid email or password' }),
    } as Response);
    render(<LoginForm />);

    await fillAndSubmit(user);

    expect(await screen.findByText('Invalid email or password')).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('shows a generic error message on a network failure', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockRejectedValueOnce(new Error('network down'));
    render(<LoginForm />);

    await fillAndSubmit(user);

    expect(await screen.findByText('An unexpected error occurred. Please try again.')).toBeInTheDocument();
  });

  it('links "Forgot password?" to /forgot-password', () => {
    render(<LoginForm />);

    expect(screen.getByRole('link', { name: /forgot password/i })).toHaveAttribute('href', '/forgot-password');
  });
});
