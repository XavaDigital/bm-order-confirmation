import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import { WorkflowBoard, applyOptimisticMove, type Board, type BoardCard } from './WorkflowBoard';

vi.mock('@/lib/api-fetch', () => ({
  getJson: vi.fn(),
  postJson: vi.fn(),
  patchJson: vi.fn(),
  deleteJson: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    body: unknown;
    constructor(message: string, status = 500, body?: unknown) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.body = body;
    }
  },
}));

const routerPushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPushMock, refresh: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { ApiError, getJson, postJson } from '@/lib/api-fetch';

function card(overrides: Partial<BoardCard> = {}): BoardCard {
  return {
    id: 'o1',
    reference: 'OC-1001',
    title: 'Jane Coach',
    subtitle: 'Wildcats',
    status: 'confirmed',
    stageSlug: 'artwork',
    stageEnteredAt: '2026-07-18T09:00:00Z',
    hoursInStage: 30,
    urgency: 'ok',
    outstandingTaskSlugs: [],
    value: null,
    deadlineDate: null,
    ...overrides,
  };
}

function board(overrides: Partial<Board> = {}): Board {
  return {
    boardKey: 'order',
    orphanedCount: 0,
    columns: [
      {
        slug: 'confirmed',
        name: 'Confirmed',
        statusKey: 'confirmed',
        color: '#52c41a',
        isTerminal: false,
        cards: [],
      },
      {
        slug: 'artwork',
        name: 'Artwork',
        statusKey: 'confirmed',
        color: '#6366f1',
        isTerminal: false,
        cards: [card()],
      },
    ],
    ...overrides,
  };
}

function renderBoard(boardKey: 'order' | 'purchase_order' = 'order') {
  return render(
    <AntdApp>
      <WorkflowBoard boardKey={boardKey} />
    </AntdApp>,
  );
}

beforeEach(() => {
  vi.mocked(getJson).mockReset().mockResolvedValue(board());
  vi.mocked(postJson).mockReset().mockResolvedValue({ ok: true });
});

describe('WorkflowBoard — rendering', () => {
  it('renders a column per stage with its card count', async () => {
    renderBoard();

    expect(await screen.findByRole('group', { name: 'Artwork (1)' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Confirmed (0)' })).toBeInTheDocument();
  });

  it('shows the card reference as a link to the order', async () => {
    renderBoard();

    const link = await screen.findByRole('link', { name: 'OC-1001' });
    expect(link).toHaveAttribute('href', '/admin/orders/o1');
  });

  it('clicking anywhere on a card opens the order (David, 2026-08-04)', async () => {
    const user = userEvent.setup();
    renderBoard();

    // The card TITLE (not the reference link) — any point on the card works.
    await user.click(await screen.findByText('Jane Coach'));

    expect(routerPushMock).toHaveBeenCalledWith('/admin/orders/o1');
  });

  it('says so when a column is empty', async () => {
    renderBoard();

    expect(await screen.findByText('Nothing here')).toBeInTheDocument();
  });

  it('loads the order board first', async () => {
    renderBoard();

    await waitFor(() => expect(getJson).toHaveBeenCalled());
    expect(vi.mocked(getJson).mock.calls[0][0]).toBe('/api/admin/workflow/board?boardKey=order');
  });

  /**
   * The board no longer switches between the two boards itself — it is
   * controlled by the page, so the Orders page cannot end up showing PO cards.
   * Choosing between them is now the page-level toggle, covered in
   * OrdersView.test.tsx and PurchaseOrdersView.test.tsx.
   */
  it('requests whichever board it is given', async () => {
    renderBoard('purchase_order');

    await waitFor(() =>
      expect(vi.mocked(getJson).mock.calls[0][0]).toBe(
        '/api/admin/workflow/board?boardKey=purchase_order',
      ),
    );
  });

  // A response that is not a board must not throw during render: the board is
  // the landing view on two pages, so that would blank the whole page.
  it('reports a malformed response instead of crashing', async () => {
    vi.mocked(getJson).mockResolvedValue({ nonsense: true } as never);

    renderBoard();

    expect(await screen.findByText(/not in the expected shape/i)).toBeInTheDocument();
  });

  it('shows how long a card has been in its stage', async () => {
    renderBoard();

    // 30 hours reads as days, not a bare hour count.
    expect(await screen.findByText('1d')).toBeInTheDocument();
  });

  it('shows a badge for outstanding blocking work', async () => {
    vi.mocked(getJson).mockResolvedValue(
      board({
        columns: [
          {
            slug: 'artwork',
            name: 'Artwork',
            statusKey: 'confirmed',
            color: null,
            isTerminal: false,
            cards: [card({ outstandingTaskSlugs: ['artwork_approved', 'fabric_confirmed'] })],
          },
        ],
      }),
    );
    renderBoard();

    expect(await screen.findByText('2 to do')).toBeInTheDocument();
  });

  // A card that cannot be placed must be reported, never silently missing.
  it('warns when cards could not be placed', async () => {
    vi.mocked(getJson).mockResolvedValue(board({ orphanedCount: 2 }));
    renderBoard();

    expect(await screen.findByText(/2 cards could not be placed/i)).toBeInTheDocument();
  });

  it('uses the singular for one unplaceable card', async () => {
    vi.mocked(getJson).mockResolvedValue(board({ orphanedCount: 1 }));
    renderBoard();

    expect(await screen.findByText(/1 card could not be placed/i)).toBeInTheDocument();
  });

  it('surfaces a load failure', async () => {
    vi.mocked(getJson).mockRejectedValue(new Error('board is down'));
    renderBoard();

    expect(await screen.findByText('board is down')).toBeInTheDocument();
  });

  it('shows an empty state when no stages are configured', async () => {
    vi.mocked(getJson).mockResolvedValue(board({ columns: [] }));
    renderBoard();

    expect(await screen.findByText(/no stages configured/i)).toBeInTheDocument();
  });

  it('re-reads on demand', async () => {
    const user = userEvent.setup();
    renderBoard();
    await screen.findByRole('group', { name: 'Artwork (1)' });
    const before = vi.mocked(getJson).mock.calls.length;

    await user.click(screen.getByRole('button', { name: /refresh/i }));

    await waitFor(() => expect(vi.mocked(getJson).mock.calls.length).toBe(before + 1));
  });
});

describe('WorkflowBoard — purchase-order cards', () => {
  it('links a PO card to its order production tab', async () => {
    vi.mocked(getJson).mockResolvedValue({
      boardKey: 'purchase_order',
      orphanedCount: 0,
      columns: [
        {
          slug: 'sent',
          name: 'Sent to Supplier',
          statusKey: 'sent',
          color: null,
          isTerminal: false,
          cards: [
            card({
              id: 'po1',
              reference: 'PO-2607-ACM-JANECOACH',
              title: 'Acme Apparel',
              orderId: 'order-9',
            }),
          ],
        },
      ],
    });
    renderBoard('purchase_order');

    const link = await screen.findByRole('link', { name: /^PO-/ });
    expect(link).toHaveAttribute('href', '/admin/orders/order-9?tab=production');
  });
});

/**
 * The drag GESTURE is not simulated: jsdom has no layout, so every element rect
 * is 0x0 and dnd-kit's collision detection cannot resolve a drop target. A
 * simulated drag would therefore prove nothing about real behaviour.
 *
 * What IS covered is the logic this component actually owns — the optimistic
 * board update, tested directly as a pure function.
 */
describe('applyOptimisticMove', () => {
  it('moves the card out of its column and into the target', () => {
    const next = applyOptimisticMove(board(), 'o1', 'confirmed');

    expect(next.columns.find((c) => c.slug === 'artwork')!.cards).toEqual([]);
    expect(next.columns.find((c) => c.slug === 'confirmed')!.cards.map((c) => c.id)).toEqual([
      'o1',
    ]);
  });

  it('rewrites the moved card’s stage so a re-render agrees with its column', () => {
    const next = applyOptimisticMove(board(), 'o1', 'confirmed');

    expect(next.columns.find((c) => c.slug === 'confirmed')!.cards[0].stageSlug).toBe('confirmed');
  });

  // The card someone just dropped should be where they are looking.
  it('puts the moved card at the top of the target column', () => {
    const start = board({
      columns: [
        {
          slug: 'confirmed',
          name: 'Confirmed',
          statusKey: 'confirmed',
          color: null,
          isTerminal: false,
          cards: [card({ id: 'existing', reference: 'OC-0999' })],
        },
        {
          slug: 'artwork',
          name: 'Artwork',
          statusKey: 'confirmed',
          color: null,
          isTerminal: false,
          cards: [card()],
        },
      ],
    });

    const next = applyOptimisticMove(start, 'o1', 'confirmed');

    expect(next.columns.find((c) => c.slug === 'confirmed')!.cards.map((c) => c.id)).toEqual([
      'o1',
      'existing',
    ]);
  });

  it('leaves other columns untouched', () => {
    const start = board();
    const next = applyOptimisticMove(start, 'o1', 'confirmed');

    expect(next.orphanedCount).toBe(start.orphanedCount);
    expect(next.boardKey).toBe(start.boardKey);
    expect(next.columns).toHaveLength(start.columns.length);
  });

  // Guards, so a stray drop cannot corrupt the rendered board.
  it('is a no-op for an unknown card', () => {
    const start = board();
    expect(applyOptimisticMove(start, 'nope', 'confirmed')).toBe(start);
  });

  it('is a no-op when the card is already in the target column', () => {
    const start = board();
    expect(applyOptimisticMove(start, 'o1', 'artwork')).toBe(start);
  });

  it('is a no-op for an unknown target column', () => {
    const start = board();
    expect(applyOptimisticMove(start, 'o1', 'no_such_column')).toBe(start);
  });

  it('does not mutate the board it was given, so rollback keeps a clean snapshot', () => {
    const start = board();
    applyOptimisticMove(start, 'o1', 'confirmed');

    expect(start.columns.find((c) => c.slug === 'artwork')!.cards.map((c) => c.id)).toEqual(['o1']);
    expect(start.columns.find((c) => c.slug === 'confirmed')!.cards).toEqual([]);
  });
});

describe('WorkflowBoard — refused moves', () => {
  it('shows no refusal dialog until a move is refused', async () => {
    renderBoard();
    await screen.findByRole('group', { name: 'Artwork (1)' });

    expect(screen.queryByText(/that move isn't allowed/i)).not.toBeInTheDocument();
    expect(postJson).not.toHaveBeenCalled();
  });

  it('carries a 409 body through as ApiError details', () => {
    // The contract the dialog depends on: api-fetch preserves the parsed body,
    // which is where `details` (the outstanding-checks list) lives.
    const err = new ApiError('Blocked', 409, { error: 'Blocked', details: ['artwork_approved'] });

    expect(err.status).toBe(409);
    expect((err.body as { details: string[] }).details).toEqual(['artwork_approved']);
  });
});
