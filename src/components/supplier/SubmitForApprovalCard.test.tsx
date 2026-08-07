/**
 * The supplier's "submit for approval" control (David, 2026-08-06).
 *
 * The behaviour worth pinning is the SWAP: once submitted, the button is gone
 * and an unmissable waiting panel stands in its place — David's "it should be
 * obvious when they've uploaded something and then they're waiting for our
 * approval". A disabled button, or a button plus a quiet note, would both fail
 * that, so both faces are asserted to exclude the other.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import { installMockFetch, type MockRoute } from '@/test/mockFetch';
import { SubmitForApprovalCard } from './SubmitForApprovalCard';

const CODE = 'DY';
const PO = 'PO-2608-DY01';
const SUBMIT_URL = `/api/supplier/${CODE}/po/${PO}/submit-approval`;

function submitRoute(overrides: Partial<MockRoute> = {}): MockRoute {
  return {
    match: SUBMIT_URL,
    method: 'POST',
    response: { ok: true, poId: 'po-1', poNumber: PO, awaitingApprovalAt: '2026-08-06T09:00:00Z' },
    ...overrides,
  };
}

function renderCard(
  props: Partial<React.ComponentProps<typeof SubmitForApprovalCard>> = {},
) {
  const onSubmitted = vi.fn().mockResolvedValue(undefined);
  render(
    <AntdApp>
      <SubmitForApprovalCard
        code={CODE}
        poNumber={PO}
        awaitingApprovalAt={null}
        awaitingApprovalNote={null}
        onSubmitted={onSubmitted}
        {...props}
      />
    </AntdApp>,
  );
  return { onSubmitted };
}

/**
 * Open the note modal and return it. The trigger and the modal's OK button are
 * both "Submit for approval", so everything after this is scoped to the dialog.
 */
async function openModal(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /submit for approval/i }));
  await screen.findByLabelText(/what are you submitting/i);
  return screen.getByRole('dialog');
}

beforeEach(() => {
  installMockFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SubmitForApprovalCard — submitting', () => {
  it('offers the button while nothing is waiting', () => {
    renderCard();

    expect(screen.getByRole('button', { name: /submit for approval/i })).toBeInTheDocument();
    expect(screen.queryByTestId('awaiting-approval-panel')).not.toBeInTheDocument();
  });

  it('posts the optional note and tells the page to re-read', async () => {
    const user = userEvent.setup();
    const { fetchMock } = installMockFetch([submitRoute()]);
    const { onSubmitted } = renderCard();

    const dialog = await openModal(user);
    await user.type(
      screen.getByLabelText(/what are you submitting/i),
      'Test print photos attached',
    );
    await user.click(within(dialog).getByRole('button', { name: /submit for approval/i }));

    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        SUBMIT_URL,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ note: 'Test print photos attached' }),
        }),
      ),
    );
    await vi.waitFor(() => expect(onSubmitted).toHaveBeenCalled());
  });

  it('submits without a note — the note is optional', async () => {
    const user = userEvent.setup();
    const { fetchMock } = installMockFetch([submitRoute()]);
    renderCard();

    const dialog = await openModal(user);
    await user.click(within(dialog).getByRole('button', { name: /submit for approval/i }));

    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        SUBMIT_URL,
        expect.objectContaining({ method: 'POST', body: '{}' }),
      ),
    );
  });

  /**
   * The 409 is the server explaining that a finished PO has nothing left to
   * approve. It must be readable — hence inside the modal, which stays open.
   */
  it('surfaces the 409 message and keeps the modal open', async () => {
    const user = userEvent.setup();
    installMockFetch([
      submitRoute({
        status: 409,
        response: {
          error: 'This purchase order is finished — there is nothing left to approve.',
        },
      }),
    ]);
    const { onSubmitted } = renderCard();

    const dialog = await openModal(user);
    await user.click(within(dialog).getByRole('button', { name: /submit for approval/i }));

    expect(await screen.findByText(/nothing left to approve/i)).toBeInTheDocument();
    // Still open — the note the factory typed is not thrown away.
    expect(screen.getByLabelText(/what are you submitting/i)).toBeInTheDocument();
    expect(onSubmitted).not.toHaveBeenCalled();
  });

  it('hands a 401 back to the page so it can show the login card', async () => {
    const user = userEvent.setup();
    installMockFetch([submitRoute({ status: 401, response: { error: 'login_required' } })]);
    const onUnauthorized = vi.fn();
    renderCard({ onUnauthorized });

    const dialog = await openModal(user);
    await user.click(within(dialog).getByRole('button', { name: /submit for approval/i }));

    await vi.waitFor(() => expect(onUnauthorized).toHaveBeenCalled());
  });
});

describe('SubmitForApprovalCard — the waiting state', () => {
  it('replaces the button with the amber waiting panel, dated', () => {
    renderCard({ awaitingApprovalAt: '2026-08-06T09:00:00Z' });

    expect(screen.getByTestId('awaiting-approval-panel')).toBeInTheDocument();
    expect(screen.getByText(/submitted for approval on 6 Aug 2026/i)).toBeInTheDocument();
    expect(screen.getByText(/waiting for BeastMode/i)).toBeInTheDocument();
    // The button must be GONE, not disabled — disabled reads as a fault.
    expect(
      screen.queryByRole('button', { name: /submit for approval/i }),
    ).not.toBeInTheDocument();
  });

  it('repeats the note they sent with it', () => {
    renderCard({
      awaitingApprovalAt: '2026-08-06T09:00:00Z',
      awaitingApprovalNote: 'Test print photos attached',
    });

    expect(screen.getByText(/Test print photos attached/)).toBeInTheDocument();
  });

  it('still says what is happening when no note was left', () => {
    renderCard({ awaitingApprovalAt: '2026-08-06T09:00:00Z' });

    expect(screen.getByText(/we will review it/i)).toBeInTheDocument();
  });
});
