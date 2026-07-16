import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ForgotPasswordForm } from './ForgotPasswordForm';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>, email = 'jane@example.com') {
  await user.type(screen.getByPlaceholderText('Email'), email);
  await user.click(screen.getByRole('button', { name: /send reset link/i }));
}

describe('ForgotPasswordForm', () => {
  it('renders the app name and email field', () => {
    render(<ForgotPasswordForm />);

    expect(screen.getByText('BeastMode')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Email')).toBeInTheDocument();
  });

  it('shows a validation error when submitting an empty form', async () => {
    const user = userEvent.setup();
    render(<ForgotPasswordForm />);

    await user.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(await screen.findByText('Enter your email')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('posts the email and shows the generic success message, replacing the form', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, message: 'generic' }),
    } as Response);
    render(<ForgotPasswordForm />);

    await fillAndSubmit(user);

    expect(fetch).toHaveBeenCalledWith('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'jane@example.com' }),
    });
    expect(await screen.findByText(/we've sent a password reset link/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Email')).not.toBeInTheDocument();
  });

  it('shows the same generic success message even for an unknown email', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, message: 'generic' }),
    } as Response);
    render(<ForgotPasswordForm />);

    await fillAndSubmit(user, 'nobody@example.com');

    expect(await screen.findByText(/we've sent a password reset link/i)).toBeInTheDocument();
  });

  it('shows a rate-limit error from the server instead of the success state', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({ error: 'Too many requests. Please try again later.' }),
    } as Response);
    render(<ForgotPasswordForm />);

    await fillAndSubmit(user);

    expect(await screen.findByText('Too many requests. Please try again later.')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Email')).toBeInTheDocument();
  });
});
