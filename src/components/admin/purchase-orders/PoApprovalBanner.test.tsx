/**
 * The staff banner for the awaiting-approval FLAG (David, 2026-08-06).
 *
 * Two things are worth pinning hardest: that it renders NOTHING when the flag
 * is clear (a banner that is always there stops being read), and that the
 * "and move to…" picker can never propose a move `canTransition` would refuse —
 * the default included.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import { installMockFetch, type MockRoute } from '@/test/mockFetch';
import { PoApprovalBanner, defaultAdvanceTo, legalAdvanceTargets } from './PoApprovalBanner';

const PO_ID = 'po-1';
const APPROVE_URL = `/api/admin/purchase-orders/${PO_ID}/approve`;

function approveRoute(overrides: Partial<MockRoute> = {}): MockRoute {
  return {
    match: APPROVE_URL,
    method: 'POST',
    response: {
      ok: true,
      poId: PO_ID,
      poNumber: 'PO-2608-DY01',
      approvedStatus: 'test_print',
      advancedTo: 'prod_layout',
    },
    ...overrides,
  };
}

function renderBanner(props: Partial<React.ComponentProps<typeof PoApprovalBanner>> = {}) {
  const onApproved = vi.fn().mockResolvedValue(undefined);
  render(
    <AntdApp>
      <PoApprovalBanner
        poId={PO_ID}
        awaitingApprovalAt="2026-08-06T09:00:00Z"
        awaitingApprovalBy="Ana (Dynasty)"
        awaitingApprovalStatus="test_print"
        awaitingApprovalNote="Test print photos attached"
        status="test_print"
        onApproved={onApproved}
        {...props}
      />
    </AntdApp>,
  );
  return { onApproved };
}

/**
 * Open the modal from the banner and return it. Both the banner action and the
 * modal's OK button are called "Approve", so every later query is scoped to the
 * dialog rather than to the page.
 */
async function openApproveModal(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Approve submission' }));
  await screen.findByLabelText(/comment to the supplier/i);
  return screen.getByRole('dialog');
}

/** The modal's own OK button. */
function confirmButton(dialog: HTMLElement) {
  return within(dialog).getByRole('button', { name: /^Approve$/ });
}

beforeEach(() => {
  installMockFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('defaultAdvanceTo', () => {
  // PO_STATUSES is declared in chain order, so "first legal" IS "next step".
  it('suggests the next step in the production chain', () => {
    expect(defaultAdvanceTo('test_print')).toBe('prod_layout');
    expect(defaultAdvanceTo('pre_production')).toBe('test_print');
    expect(defaultAdvanceTo('in_production')).toBe('quality_control');
  });

  // The live flow is Unconfirmed → Design prep; `confirmed` only exists for
  // rows that predate it, so suggesting it would park POs in a dead status.
  it('skips the legacy Confirmed status', () => {
    expect(defaultAdvanceTo('sent')).toBe('pre_production');
  });

  // Both are deliberate decisions, never something an Approve click pre-fills.
  it('never suggests remake or cancelled', () => {
    expect(defaultAdvanceTo('received')).toBe('completed');
    expect(defaultAdvanceTo('completed')).toBeNull();
    expect(defaultAdvanceTo('draft')).toBe('approved');
  });

  it('suggests nothing from a terminal status', () => {
    expect(defaultAdvanceTo('cancelled')).toBeNull();
  });

  it('offers remake as a CHOICE even though it is never the default', () => {
    expect(legalAdvanceTargets('received')).toContain('remake');
    expect(legalAdvanceTargets('received')).toContain('completed');
  });

  it('never offers a backwards move', () => {
    expect(legalAdvanceTargets('in_production')).not.toContain('pre_production');
  });
});

describe('PoApprovalBanner — the banner', () => {
  it('renders nothing when the flag is clear', () => {
    const { container } = render(
      <AntdApp>
        <PoApprovalBanner
          poId={PO_ID}
          awaitingApprovalAt={null}
          awaitingApprovalBy={null}
          awaitingApprovalStatus={null}
          awaitingApprovalNote={null}
          status="test_print"
          onApproved={vi.fn()}
        />
      </AntdApp>,
    );

    expect(screen.queryByTestId('awaiting-approval-banner')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent(/approval/i);
  });

  it('says who submitted what, when — with the status LABEL, not its value', () => {
    renderBanner();

    expect(screen.getByTestId('awaiting-approval-banner')).toBeInTheDocument();
    expect(
      screen.getByText('Ana (Dynasty) submitted Test print for approval on 6 Aug 2026'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Test print photos attached/)).toBeInTheDocument();
  });

  // The submitted phase can differ from where the PO sits now; the banner
  // reports what was SUBMITTED, since that is what is being approved.
  it('reports the submitted status even when the PO has since moved', () => {
    renderBanner({ awaitingApprovalStatus: 'pre_production', status: 'test_print' });

    expect(screen.getByText(/submitted Design prep for approval/)).toBeInTheDocument();
  });

  it('says so when no note was left', () => {
    renderBanner({ awaitingApprovalNote: null });

    expect(screen.getByText(/no note was left/i)).toBeInTheDocument();
  });
});

describe('PoApprovalBanner — approving', () => {
  it('approves with the suggested next status and the comment', async () => {
    const user = userEvent.setup();
    const { fetchMock } = installMockFetch([approveRoute()]);
    const { onApproved } = renderBanner();

    const dialog = await openApproveModal(user);
    await user.type(screen.getByLabelText(/comment to the supplier/i), 'Looks good, carry on');
    await user.click(confirmButton(dialog));

    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        APPROVE_URL,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ advanceTo: 'prod_layout', comment: 'Looks good, carry on' }),
        }),
      ),
    );
    await vi.waitFor(() => expect(onApproved).toHaveBeenCalled());
  });

  // Approving a status with nowhere forward to go is still a legitimate act:
  // it clears the flag and tells the supplier, without moving anything.
  it('approves without moving the status when nothing forward is legal', async () => {
    const user = userEvent.setup();
    const { fetchMock } = installMockFetch([
      approveRoute({ response: { ok: true, approvedStatus: 'completed', advancedTo: null } }),
    ]);
    renderBanner({ status: 'completed', awaitingApprovalStatus: 'completed' });

    const dialog = await openApproveModal(user);
    await user.click(confirmButton(dialog));

    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        APPROVE_URL,
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ advanceTo: null }) }),
      ),
    );
  });

  /**
   * The picker is built straight from `legalAdvanceTargets` (asserted above as
   * a pure function — the dropdown itself is virtualised, so counting rendered
   * options in jsdom would measure rc-virtual-list, not the offer). What is
   * checked here is the visible half: it opens pre-filled with the next step,
   * in its LABEL, so nobody has to know the enum values.
   */
  it('pre-fills the picker with the next step in the chain', async () => {
    const user = userEvent.setup();
    installMockFetch([approveRoute()]);
    renderBanner();

    const dialog = await openApproveModal(user);

    expect(within(dialog).getByTitle('Prod layout')).toBeInTheDocument();
    expect(within(dialog).getByRole('combobox', { name: /and move to/i })).toBeInTheDocument();
  });

  it('keeps the modal open and shows a refusal verbatim', async () => {
    const user = userEvent.setup();
    installMockFetch([
      approveRoute({
        status: 409,
        response: { error: 'This purchase order is not waiting for approval' },
      }),
    ]);
    const { onApproved } = renderBanner();

    const dialog = await openApproveModal(user);
    await user.click(confirmButton(dialog));

    expect(await screen.findByText(/not waiting for approval/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/comment to the supplier/i)).toBeInTheDocument();
    expect(onApproved).not.toHaveBeenCalled();
  });
});
