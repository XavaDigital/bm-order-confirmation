import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccessCodeGate } from './AccessCodeGate';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

async function enterCode(user: ReturnType<typeof userEvent.setup>, code: string) {
  // antd Input.OTP renders one text input per digit; focus the first and paste the full code.
  const inputs = screen.getAllByRole('textbox');
  await user.click(inputs[0]);
  await user.paste(code);
}

beforeEach(() => {
  refreshMock.mockClear();
  vi.stubGlobal('fetch', vi.fn());
});

describe('AccessCodeGate', () => {
  it('shows the code-required prompt', () => {
    render(<AccessCodeGate token="raw-token" />);

    expect(screen.getByText('Access Code Required')).toBeInTheDocument();
  });

  it('a correct 6-digit code verifies against the API and refreshes the router', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response);
    render(<AccessCodeGate token="raw-token" />);

    await enterCode(user, '123456');

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith(
      '/api/o/verify-code',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ token: 'raw-token', code: '123456' }),
      }),
    ));
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it('a wrong code shows a generic error and clears the input', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Invalid code' }),
    } as Response);
    render(<AccessCodeGate token="raw-token" />);

    await enterCode(user, '000000');

    expect(await screen.findByText('Incorrect code. Please try again.')).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('a 429 response surfaces the rate-limit message from the API', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({ error: 'Too many attempts. Please try again in 15 minutes.' }),
    } as Response);
    render(<AccessCodeGate token="raw-token" />);

    await enterCode(user, '111111');

    expect(await screen.findByText('Too many attempts. Please try again in 15 minutes.')).toBeInTheDocument();
  });

  it('a network failure shows a fallback error message', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockRejectedValueOnce(new Error('network down'));
    render(<AccessCodeGate token="raw-token" />);

    await enterCode(user, '222222');

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
  });
});
