/**
 * The "customer hasn't seen these changes" banner (David, 2026-08-07).
 *
 * Two things are worth pinning hardest. First, it must LIST what changed — a
 * warning nobody can act on gets dismissed. Second, it sits above the whole
 * order page, so an unexpected response has to make it disappear quietly
 * rather than take the page down; that exact crash happened once already.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp } from 'antd';

vi.mock('@/lib/api-fetch', () => ({
  getJson: vi.fn(),
  postJson: vi.fn(),
  deleteJson: vi.fn(),
}));

import { deleteJson, getJson, postJson } from '@/lib/api-fetch';
import { ReconfirmationBanner } from './ReconfirmationBanner';

function state(overrides: Record<string, unknown> = {}) {
  return {
    status: 'drifted',
    changes: [
      { key: 'garment:Home Jersey:quantity', severity: 'material', label: 'Home Jersey: quantity 20 → 24' },
      { key: 'deadlineDate', severity: 'minor', label: 'Deadline: 2026-09-15 → 2026-10-01' },
    ],
    hasMaterialChanges: true,
    confirmedRevision: 1,
    requestedAt: null,
    requestedBy: null,
    requestedNote: null,
    ...overrides,
  };
}

function renderBanner(canMutate = true) {
  return render(
    <AntdApp>
      <ReconfirmationBanner orderId="order-1" canMutate={canMutate} />
    </AntdApp>,
  );
}

beforeEach(() => {
  vi.mocked(getJson).mockReset();
  vi.mocked(postJson).mockReset();
  vi.mocked(deleteJson).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ReconfirmationBanner — when it appears', () => {
  it('says nothing about an order that matches what was agreed', async () => {
    vi.mocked(getJson).mockResolvedValue(state({ status: 'in_sync', changes: [] }));
    renderBanner();

    await vi.waitFor(() => expect(getJson).toHaveBeenCalled());
    expect(screen.queryByText(/has changed since/i)).not.toBeInTheDocument();
  });

  it('says nothing about an order nobody has confirmed', async () => {
    vi.mocked(getJson).mockResolvedValue(state({ status: 'not_confirmed', changes: [] }));
    renderBanner();

    await vi.waitFor(() => expect(getJson).toHaveBeenCalled());
    expect(screen.queryByText(/has changed since/i)).not.toBeInTheDocument();
  });

  // The crash that took the whole order page down: `changes` absent from the
  // response and the banner read `.length` off undefined.
  it('disappears quietly when the response is not the expected shape', async () => {
    vi.mocked(getJson).mockResolvedValue({ unexpected: true });
    renderBanner();

    await vi.waitFor(() => expect(getJson).toHaveBeenCalled());
    expect(screen.queryByText(/has changed since/i)).not.toBeInTheDocument();
  });

  it('disappears quietly when the check itself fails', async () => {
    vi.mocked(getJson).mockRejectedValue(new Error('boom'));
    renderBanner();

    await vi.waitFor(() => expect(getJson).toHaveBeenCalled());
    expect(screen.queryByText(/has changed since/i)).not.toBeInTheDocument();
  });
});

describe('ReconfirmationBanner — a drifted order', () => {
  it('names every change and marks which ones need agreeing', async () => {
    vi.mocked(getJson).mockResolvedValue(state());
    renderBanner();

    expect(
      await screen.findByText(/this order has changed since the customer confirmed it/i),
    ).toBeInTheDocument();
    expect(screen.getByText('Home Jersey: quantity 20 → 24')).toBeInTheDocument();
    expect(screen.getByText('Deadline: 2026-09-15 → 2026-10-01')).toBeInTheDocument();
    expect(screen.getByText('Needs agreeing')).toBeInTheDocument();
    expect(screen.getByText('Minor')).toBeInTheDocument();
  });

  it('says purchase orders are held', async () => {
    vi.mocked(getJson).mockResolvedValue(state());
    renderBanner();

    expect(await screen.findByText(/purchase orders for this job are held/i)).toBeInTheDocument();
  });

  // Minor changes alone hold nothing, and the wording has to say so or staff
  // will chase customers over a moved ship date.
  it('reads differently, and holds nothing, when only minor things changed', async () => {
    vi.mocked(getJson).mockResolvedValue(
      state({
        status: 'minor_changes',
        hasMaterialChanges: false,
        changes: [{ key: 'deadlineDate', severity: 'minor', label: 'Deadline moved' }],
      }),
    );
    renderBanner();

    expect(await screen.findByText(/small changes since the customer confirmed/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing is held/i)).toBeInTheDocument();
  });

  it('offers no ask button to someone who cannot mutate', async () => {
    vi.mocked(getJson).mockResolvedValue(state());
    renderBanner(false);

    await screen.findByText(/this order has changed/i);
    expect(screen.queryByTestId('ask-reconfirm')).not.toBeInTheDocument();
  });
});

describe('ReconfirmationBanner — asking the customer', () => {
  it('sends the note and the email choice, and shows what changed in the dialog', async () => {
    const user = userEvent.setup();
    vi.mocked(getJson).mockResolvedValue(state());
    vi.mocked(postJson).mockResolvedValue(
      state({ status: 'awaiting_customer', requestedBy: 'sam@x.com', emailSent: true }),
    );
    renderBanner();

    await user.click(await screen.findByTestId('ask-reconfirm'));
    const dialog = await screen.findByRole('dialog');
    // The list is repeated in the dialog: this is the moment of deciding.
    expect(within(dialog).getByText('Home Jersey: quantity 20 → 24')).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText('Note to the customer'), 'As discussed');
    await user.click(within(dialog).getByRole('button', { name: 'Ask to confirm' }));

    await vi.waitFor(() =>
      expect(postJson).toHaveBeenCalledWith(
        '/api/admin/orders/order-1/reconfirm',
        { note: 'As discussed', sendEmail: true },
        expect.any(String),
      ),
    );
  });

  it('switches to the waiting message afterwards', async () => {
    const user = userEvent.setup();
    vi.mocked(getJson).mockResolvedValue(state());
    vi.mocked(postJson).mockResolvedValue(
      state({ status: 'awaiting_customer', requestedBy: 'sam@x.com' }),
    );
    renderBanner();

    await user.click(await screen.findByTestId('ask-reconfirm'));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Ask to confirm' }));

    expect(
      await screen.findByText(/waiting for the customer to confirm again/i),
    ).toBeInTheDocument();
  });

  it('can send without emailing, for when another conversation is already happening', async () => {
    const user = userEvent.setup();
    vi.mocked(getJson).mockResolvedValue(state());
    vi.mocked(postJson).mockResolvedValue(state({ status: 'awaiting_customer' }));
    renderBanner();

    await user.click(await screen.findByTestId('ask-reconfirm'));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('checkbox', { name: /email them the link now/i }));
    await user.click(within(dialog).getByRole('button', { name: 'Ask to confirm' }));

    await vi.waitFor(() =>
      expect(postJson).toHaveBeenCalledWith(
        '/api/admin/orders/order-1/reconfirm',
        expect.objectContaining({ sendEmail: false }),
        expect.any(String),
      ),
    );
  });
});

describe('ReconfirmationBanner — while waiting', () => {
  const waiting = () =>
    state({
      status: 'awaiting_customer',
      requestedBy: 'sam@x.com',
      requestedNote: 'We added the four larges',
    });

  it('names who asked and repeats the note that was sent', async () => {
    vi.mocked(getJson).mockResolvedValue(waiting());
    renderBanner();

    expect(await screen.findByText(/waiting for the customer/i)).toBeInTheDocument();
    expect(screen.getByText(/sam@x.com/)).toBeInTheDocument();
    expect(screen.getByText('We added the four larges')).toBeInTheDocument();
  });

  // The phone call that overtakes the email.
  it('can be withdrawn when they already agreed another way', async () => {
    const user = userEvent.setup();
    vi.mocked(getJson).mockResolvedValue(waiting());
    vi.mocked(deleteJson).mockResolvedValue(state({ status: 'drifted' }));
    renderBanner();

    await user.click(await screen.findByRole('button', { name: /they already agreed/i }));

    await vi.waitFor(() =>
      expect(deleteJson).toHaveBeenCalledWith(
        '/api/admin/orders/order-1/reconfirm',
        expect.any(String),
      ),
    );
    expect(await screen.findByText(/this order has changed since/i)).toBeInTheDocument();
  });
});
