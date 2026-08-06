import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { installMockFetch } from '@/test/mockFetch';
import { PoChecklistCard, usePoChecklist, type PoChecklistItem } from './PoChecklistCard';

const PO_ID = 'po-1';

function autoItem(overrides: Partial<PoChecklistItem> = {}): PoChecklistItem {
  return {
    id: 'a1',
    label: 'At least one design file attached',
    autoRule: 'design_file_attached',
    satisfied: true,
    auto: true,
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
    checkedByEmail: null,
    checkedAt: null,
    ...overrides,
  };
}

/** The page's wiring: the hook owns the data, the card renders it. */
function Harness({ poId }: { poId: string }) {
  const { items, loadError, toggle } = usePoChecklist(poId);
  return (
    <PoChecklistCard
      items={items}
      loadError={loadError}
      onToggle={(itemId, checked) => void toggle(itemId, checked)}
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
      {
        match: `/api/admin/purchase-orders/${PO_ID}/checklist`,
        method: 'GET',
        response: { items: [autoItem(), manualItem()] },
      },
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
      {
        match: `/api/admin/purchase-orders/${PO_ID}/checklist`,
        method: 'GET',
        response: { items: [autoItem(), manualItem()] },
      },
    ]);
    render(<Harness poId={PO_ID} />);

    expect(await screen.findByTestId('checklist-progress')).toHaveTextContent('1 of 2 complete');
    // Outstanding items render in the warning tone; satisfied ones don't.
    // (`Text strong` nests a <strong>, so climb to the typography span.)
    expect(
      screen.getByText('Design file includes colours').closest('.ant-typography')!.className,
    ).toContain('warning');
    expect(
      screen.getByText('At least one design file attached').closest('.ant-typography')!.className,
    ).not.toContain('warning');
    expect(screen.getByText(/sending is blocked until every item is complete/i)).toBeInTheDocument();
  });

  it('shows who/when subtext on a ticked manual item', async () => {
    installMockFetch([
      {
        match: `/api/admin/purchase-orders/${PO_ID}/checklist`,
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
      {
        match: `/api/admin/purchase-orders/${PO_ID}/checklist`,
        method: 'GET',
        response: { items: [manualItem()] },
      },
    ]);
    addRoute({
      match: `/api/admin/purchase-orders/${PO_ID}/checklist`,
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
      expect(post?.[0]).toBe(`/api/admin/purchase-orders/${PO_ID}/checklist`);
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
        match: `/api/admin/purchase-orders/${PO_ID}/checklist`,
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
    addRoute({
      match: `/api/admin/purchase-orders/${PO_ID}/checklist`,
      method: 'POST',
      response: { items: [manualItem()] },
    });
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
    installMockFetch([
      {
        match: `/api/admin/purchase-orders/${PO_ID}/checklist`,
        method: 'GET',
        response: { items: [] },
      },
    ]);
    render(<Harness poId={PO_ID} />);

    expect(await screen.findByText('No checklist items configured.')).toBeInTheDocument();
    expect(screen.queryByTestId('checklist-progress')).not.toBeInTheDocument();
  });

  it('renders progress within the card header context without crashing on load errors', async () => {
    installMockFetch([
      {
        match: `/api/admin/purchase-orders/${PO_ID}/checklist`,
        method: 'GET',
        status: 500,
        response: { error: 'boom' },
      },
    ]);
    render(<Harness poId={PO_ID} />);

    expect(await screen.findByText('Failed to load the checklist.')).toBeInTheDocument();
  });

  it('keeps checkboxes and progress consistent with a mixed satisfied set', async () => {
    installMockFetch([
      {
        match: `/api/admin/purchase-orders/${PO_ID}/checklist`,
        method: 'GET',
        response: {
          items: [
            autoItem(),
            manualItem({ id: 'm1', satisfied: true, checkedByEmail: 'ana@example.com', checkedAt: '2026-08-05T10:00:00Z' }),
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
});
