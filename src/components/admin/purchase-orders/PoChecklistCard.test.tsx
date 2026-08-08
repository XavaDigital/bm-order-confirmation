import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { installMockFetch } from '@/test/mockFetch';
import { PoChecklistCard, usePoChecklist, type PoChecklistItem } from './PoChecklistCard';

const PO_ID = 'po-1';
const CHECKLIST_URL = `/api/admin/purchase-orders/${PO_ID}/checklist`;

function autoItem(overrides: Partial<PoChecklistItem> = {}): PoChecklistItem {
  return {
    id: 'a1',
    label: 'At least one design file attached',
    autoRule: 'design_file_attached',
    satisfied: true,
    auto: true,
    allowSidestep: false,
    sidestepped: false,
    sidestepReason: null,
    checkedByEmail: null,
    checkedAt: null,
    ...overrides,
  };
}

function manualItem(overrides: Partial<PoChecklistItem> = {}): PoChecklistItem {
  return {
    id: 'm1',
    label: 'Design file includes colours',
    autoRule: null,
    satisfied: false,
    auto: false,
    allowSidestep: false,
    sidestepped: false,
    sidestepReason: null,
    checkedByEmail: null,
    checkedAt: null,
    ...overrides,
  };
}

/** A check David configured as skippable-with-a-reason. */
function sidesteppableItem(overrides: Partial<PoChecklistItem> = {}): PoChecklistItem {
  return manualItem({
    id: 's1',
    label: 'Checked whether any fonts need to be uploaded',
    allowSidestep: true,
    ...overrides,
  });
}

/** The page's wiring: the hook owns the data, the card renders it. */
function Harness({ poId }: { poId: string }) {
  const { items, loadError, toggle } = usePoChecklist(poId);
  return (
    <PoChecklistCard
      items={items}
      loadError={loadError}
      onToggle={(itemId, checked, reason) => toggle(itemId, checked, reason)}
    />
  );
}

beforeEach(() => {
  installMockFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PoChecklistCard', () => {
  it('renders auto items checked + disabled with an auto tag, manual items live', async () => {
    installMockFetch([
      { match: CHECKLIST_URL, method: 'GET', response: { items: [autoItem(), manualItem()] } },
    ]);
    render(<Harness poId={PO_ID} />);

    expect(await screen.findByText('Pre-send checklist')).toBeInTheDocument();

    const auto = screen
      .getByText('At least one design file attached')
      .closest('label')!
      .querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(auto.checked).toBe(true);
    expect(auto.disabled).toBe(true);
    expect(screen.getByText('auto')).toBeInTheDocument();

    const manual = screen
      .getByText('Design file includes colours')
      .closest('label')!
      .querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(manual.checked).toBe(false);
    expect(manual.disabled).toBe(false);
  });

  it('shows the progress line and makes unsatisfied items stand out', async () => {
    installMockFetch([
      { match: CHECKLIST_URL, method: 'GET', response: { items: [autoItem(), manualItem()] } },
    ]);
    render(<Harness poId={PO_ID} />);

    expect(await screen.findByTestId('checklist-progress')).toHaveTextContent('1 of 2 complete');
    // Red outstanding, green done (David, 2026-08-08). The three colours are
    // the whole signal on this card, so each one is asserted rather than just
    // "differs from the other". (`Text strong` nests a <strong>, so climb to
    // the typography span.)
    expect(
      screen.getByText('Design file includes colours').closest('.ant-typography')!.className,
    ).toContain('danger');
    expect(
      screen.getByText('At least one design file attached').closest('.ant-typography')!.className,
    ).toContain('success');
    // The progress line is red while anything is outstanding — it blocks the send.
    expect(screen.getByTestId('checklist-progress').className).toContain('danger');
    expect(screen.getByText(/sending is blocked until every item is complete/i)).toBeInTheDocument();
  });

  // Orange, not green: a sidestep is satisfied, but it is not the same fact as
  // done and must not look identical to work that actually happened.
  it('renders a sidestepped item in the warning tone, not the success one', async () => {
    installMockFetch([
      {
        match: CHECKLIST_URL,
        method: 'GET',
        response: {
          items: [
            manualItem({
              satisfied: true,
              sidestepped: true,
              sidestepReason: 'no fonts on this job',
              checkedByEmail: 'sam@x.com',
            }),
          ],
        },
      },
    ]);
    render(<Harness poId={PO_ID} />);

    const label = await screen.findByText('Design file includes colours');
    expect(label.closest('.ant-typography')!.className).toContain('warning');
    expect(label.closest('.ant-typography')!.className).not.toContain('success');
    // Everything satisfied, but some of it sidestepped — the summary says so.
    expect(screen.getByTestId('checklist-progress').className).toContain('warning');
  });

  it('shows who/when subtext on a ticked manual item', async () => {
    installMockFetch([
      {
        match: CHECKLIST_URL,
        method: 'GET',
        response: {
          items: [
            manualItem({
              satisfied: true,
              checkedByEmail: 'ana@example.com',
              checkedAt: '2026-08-06T10:00:00Z',
            }),
          ],
        },
      },
    ]);
    render(<Harness poId={PO_ID} />);

    expect(await screen.findByText('ana@example.com — 6 Aug 2026')).toBeInTheDocument();
    expect(screen.getByTestId('checklist-progress')).toHaveTextContent('1 of 1 complete');
  });

  it('ticking a manual item POSTs the toggle and re-renders from the response', async () => {
    const user = userEvent.setup();
    const { fetchMock, addRoute } = installMockFetch([
      { match: CHECKLIST_URL, method: 'GET', response: { items: [manualItem()] } },
    ]);
    addRoute({
      match: CHECKLIST_URL,
      method: 'POST',
      response: {
        items: [
          manualItem({
            satisfied: true,
            checkedByEmail: 'staff@example.com',
            checkedAt: '2026-08-06T10:00:00Z',
          }),
        ],
      },
    });
    render(<Harness poId={PO_ID} />);
    await screen.findByText('Design file includes colours');

    await user.click(screen.getByRole('checkbox'));

    await vi.waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(post?.[0]).toBe(CHECKLIST_URL);
      expect(JSON.parse(post![1]!.body as string)).toEqual({ itemId: 'm1', checked: true });
    });
    // The fresh server state drives the card — tick recorded with who/when.
    expect(await screen.findByText('staff@example.com — 6 Aug 2026')).toBeInTheDocument();
    expect(screen.getByTestId('checklist-progress')).toHaveTextContent('1 of 1 complete');
  });

  it('unticking a ticked manual item POSTs checked: false', async () => {
    const user = userEvent.setup();
    const { fetchMock, addRoute } = installMockFetch([
      {
        match: CHECKLIST_URL,
        method: 'GET',
        response: {
          items: [
            manualItem({
              satisfied: true,
              checkedByEmail: 'ana@example.com',
              checkedAt: '2026-08-06T10:00:00Z',
            }),
          ],
        },
      },
    ]);
    addRoute({ match: CHECKLIST_URL, method: 'POST', response: { items: [manualItem()] } });
    render(<Harness poId={PO_ID} />);
    await screen.findByText('Design file includes colours');

    await user.click(screen.getByRole('checkbox'));

    await vi.waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(JSON.parse(post![1]!.body as string)).toEqual({ itemId: 'm1', checked: false });
    });
    expect(await screen.findByTestId('checklist-progress')).toHaveTextContent('0 of 1 complete');
  });

  it('renders the empty state when no items are configured', async () => {
    installMockFetch([{ match: CHECKLIST_URL, method: 'GET', response: { items: [] } }]);
    render(<Harness poId={PO_ID} />);

    expect(await screen.findByText('No checklist items configured.')).toBeInTheDocument();
    expect(screen.queryByTestId('checklist-progress')).not.toBeInTheDocument();
  });

  it('renders progress within the card header context without crashing on load errors', async () => {
    installMockFetch([
      { match: CHECKLIST_URL, method: 'GET', status: 500, response: { error: 'boom' } },
    ]);
    render(<Harness poId={PO_ID} />);

    expect(await screen.findByText('Failed to load the checklist.')).toBeInTheDocument();
  });

  it('keeps checkboxes and progress consistent with a mixed satisfied set', async () => {
    installMockFetch([
      {
        match: CHECKLIST_URL,
        method: 'GET',
        response: {
          items: [
            autoItem(),
            manualItem({
              id: 'm1',
              satisfied: true,
              checkedByEmail: 'ana@example.com',
              checkedAt: '2026-08-05T10:00:00Z',
            }),
            manualItem({ id: 'm2', label: 'Checked whether any fonts need to be uploaded' }),
          ],
        },
      },
    ]);
    render(<Harness poId={PO_ID} />);

    expect(await screen.findByTestId('checklist-progress')).toHaveTextContent('2 of 3 complete');
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.map((b) => b.checked)).toEqual([true, true, false]);
  });

  // --- sidestep (David, 2026-08-06) -----------------------------------------

  it('offers Sidestep only on items configured to allow it', async () => {
    installMockFetch([
      {
        match: CHECKLIST_URL,
        method: 'GET',
        response: { items: [manualItem(), sidesteppableItem()] },
      },
    ]);
    render(<Harness poId={PO_ID} />);
    await screen.findByText('Design file includes colours');

    // One button, and it belongs to the sidesteppable row.
    const buttons = screen.getAllByRole('button', { name: 'Sidestep' });
    expect(buttons).toHaveLength(1);
    expect(within(screen.getByTestId('checklist-item-s1')).getByRole('button', { name: 'Sidestep' }))
      .toBeInTheDocument();
    expect(
      within(screen.getByTestId('checklist-item-m1')).queryByRole('button', { name: 'Sidestep' }),
    ).not.toBeInTheDocument();
  });

  it('sidesteps with a reason: POSTs the reason and re-renders from the response', async () => {
    const user = userEvent.setup();
    const { fetchMock, addRoute } = installMockFetch([
      { match: CHECKLIST_URL, method: 'GET', response: { items: [sidesteppableItem()] } },
    ]);
    addRoute({
      match: CHECKLIST_URL,
      method: 'POST',
      response: {
        items: [
          sidesteppableItem({
            satisfied: true,
            sidestepped: true,
            sidestepReason: 'no fonts on this job',
            checkedByEmail: 'ana@example.com',
            checkedAt: '2026-08-06T10:00:00Z',
          }),
        ],
      },
    });
    render(<Harness poId={PO_ID} />);
    await screen.findByText('Checked whether any fonts need to be uploaded');

    await user.click(screen.getByRole('button', { name: 'Sidestep' }));
    // The modal explains what is being recorded before it asks for the reason.
    expect(await screen.findByText(/acknowledged rather than done/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Reason for sidestepping'), 'no fonts on this job');
    await user.click(screen.getByRole('button', { name: 'Record sidestep' }));

    await vi.waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(JSON.parse(post![1]!.body as string)).toEqual({
        itemId: 's1',
        checked: true,
        sidestepReason: 'no fonts on this job',
      });
    });
    // Recorded as a sidestep — visibly NOT the same thing as a tick.
    expect(await screen.findByText('Sidestepped')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Sidestepped by ana@example.com — "no fonts on this job" — 6 Aug 2026',
      ),
    ).toBeInTheDocument();
    // Satisfied, so the progress counts it — but it is called out separately
    // and the line stays amber rather than going green.
    const progress = screen.getByTestId('checklist-progress');
    expect(progress).toHaveTextContent('1 of 1 complete · 1 sidestepped');
    expect(progress.className).toContain('warning');
  });

  it('refuses to send a reason shorter than a few characters', async () => {
    const user = userEvent.setup();
    const { fetchMock } = installMockFetch([
      { match: CHECKLIST_URL, method: 'GET', response: { items: [sidesteppableItem()] } },
    ]);
    render(<Harness poId={PO_ID} />);
    await screen.findByText('Checked whether any fonts need to be uploaded');

    await user.click(screen.getByRole('button', { name: 'Sidestep' }));
    await user.type(await screen.findByLabelText('Reason for sidestepping'), 'x');
    await user.click(screen.getByRole('button', { name: 'Record sidestep' }));

    expect(await screen.findByText(/give a reason/i)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('keeps the modal open and shows the server refusal when the item cannot be sidestepped', async () => {
    const user = userEvent.setup();
    const { addRoute } = installMockFetch([
      // The server is the enforcement: the UI can be out of date about which
      // checks are sidesteppable, and a 409 must not look like success.
      { match: CHECKLIST_URL, method: 'GET', response: { items: [sidesteppableItem()] } },
    ]);
    addRoute({
      match: CHECKLIST_URL,
      method: 'POST',
      status: 409,
      response: {
        error:
          '"Checked whether any fonts need to be uploaded" cannot be sidestepped — it has to be done',
      },
    });
    render(<Harness poId={PO_ID} />);
    await screen.findByText('Checked whether any fonts need to be uploaded');

    await user.click(screen.getByRole('button', { name: 'Sidestep' }));
    await user.type(await screen.findByLabelText('Reason for sidestepping'), 'no fonts on this job');
    await user.click(screen.getByRole('button', { name: 'Record sidestep' }));

    expect(await screen.findByText(/cannot be sidestepped — it has to be done/)).toBeInTheDocument();
    // Still open, still asking, and the item is still outstanding.
    expect(screen.getByLabelText('Reason for sidestepping')).toBeInTheDocument();
    expect(screen.getByTestId('checklist-progress')).toHaveTextContent('0 of 1 complete');
  });

  it('a sidestepped item offers no second Sidestep and unticks through the normal path', async () => {
    const user = userEvent.setup();
    const { fetchMock, addRoute } = installMockFetch([
      {
        match: CHECKLIST_URL,
        method: 'GET',
        response: {
          items: [
            sidesteppableItem({
              satisfied: true,
              sidestepped: true,
              sidestepReason: 'no fonts on this job',
              checkedByEmail: 'ana@example.com',
              checkedAt: '2026-08-06T10:00:00Z',
            }),
          ],
        },
      },
    ]);
    addRoute({ match: CHECKLIST_URL, method: 'POST', response: { items: [sidesteppableItem()] } });
    render(<Harness poId={PO_ID} />);
    await screen.findByText('Sidestepped');

    expect(screen.queryByRole('button', { name: 'Sidestep' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('checkbox'));

    await vi.waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(JSON.parse(post![1]!.body as string)).toEqual({ itemId: 's1', checked: false });
    });
    // Back to outstanding — no reason, no tag.
    expect(await screen.findByTestId('checklist-progress')).toHaveTextContent('0 of 1 complete');
    expect(screen.queryByText('Sidestepped')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sidestep' })).toBeInTheDocument();
  });

  it('a sidestepped item reads differently from a done tick', async () => {
    installMockFetch([
      {
        match: CHECKLIST_URL,
        method: 'GET',
        response: {
          items: [
            manualItem({
              satisfied: true,
              checkedByEmail: 'sam@example.com',
              checkedAt: '2026-08-06T10:00:00Z',
            }),
            sidesteppableItem({
              satisfied: true,
              sidestepped: true,
              sidestepReason: 'no fonts on this job',
              checkedByEmail: 'ana@example.com',
              checkedAt: '2026-08-06T10:00:00Z',
            }),
          ],
        },
      },
    ]);
    render(<Harness poId={PO_ID} />);

    // Done: neutral label. Sidestepped: warning tone + its own tag.
    expect(
      (await screen.findByText('Design file includes colours')).closest('.ant-typography')!
        .className,
    ).not.toContain('warning');
    expect(
      screen
        .getByText('Checked whether any fonts need to be uploaded')
        .closest('.ant-typography')!.className,
    ).toContain('warning');
    expect(
      within(screen.getByTestId('checklist-item-s1')).getByText('Sidestepped'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('checklist-item-m1')).queryByText('Sidestepped'),
    ).not.toBeInTheDocument();
    // Everything satisfied, so nothing blocks the send.
    expect(
      screen.queryByText(/sending is blocked until every item is complete/i),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('checklist-progress')).toHaveTextContent('2 of 2 complete · 1 sidestepped');
  });
});

/**
 * Short title, explanation underneath (David, 2026-08-08: "will make the list
 * more scannable"). The explanation is quiet so the list reads by title alone.
 */
describe('PoChecklistCard — titles and explanations', () => {
  it('shows the explanation under the title', async () => {
    installMockFetch([
      {
        match: CHECKLIST_URL,
        method: 'GET',
        response: {
          items: [
            manualItem({
              label: 'Size charts',
              description: 'Every garment has a size chart for the factory to cut to.',
            }),
          ],
        },
      },
    ]);
    render(<Harness poId={PO_ID} />);

    expect(await screen.findByText('Size charts')).toBeInTheDocument();
    expect(
      screen.getByText('Every garment has a size chart for the factory to cut to.'),
    ).toBeInTheDocument();
  });

  it('renders a check with no explanation without leaving an empty line', async () => {
    installMockFetch([
      { match: CHECKLIST_URL, method: 'GET', response: { items: [manualItem({ description: null })] } },
    ]);
    render(<Harness poId={PO_ID} />);

    const label = await screen.findByText('Design file includes colours');
    // The title is the only text in the item when there is nothing to explain.
    expect(label.closest('[data-testid^="checklist-item-"]')!.textContent).toBe(
      'Design file includes colours',
    );
  });
});
