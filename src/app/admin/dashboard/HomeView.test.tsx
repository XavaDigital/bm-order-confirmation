import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { App as AntdApp } from 'antd';
import { HomeView } from './HomeView';

function localYMD(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysFromNow(offset: number) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return localYMD(d);
}

function baseProps(overrides: Partial<React.ComponentProps<typeof HomeView>> = {}) {
  return {
    counts: { sent: 0, viewed: 0, changesRequested: 0 },
    recentOrders: [],
    staleOrders: [],
    stuckInProduction: [],
    upcomingDeadlines: [],
    colorSampleHolds: [],
    role: 'sales' as const,
    failedEvents: [],
    ...overrides,
  };
}

function failedEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'event-1',
    eventType: 'order.confirmed',
    aggregateType: 'order',
    aggregateId: 'order-1',
    status: 'failed' as const,
    attempts: 2,
    createdAt: '2026-07-10T09:00:00Z',
    nextAttemptAt: null,
    ...overrides,
  };
}

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    orderNumber: 'OC-1',
    customerName: 'Jane Coach',
    clubName: 'Wildcats',
    createdAt: '2026-06-01T10:00:00Z',
    status: 'sent',
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-10T12:00:00Z'));
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.useRealTimers();
});

describe('HomeView', () => {
  it('shows the "no stale orders" empty state for Needs Follow-up', () => {
    render(<HomeView {...baseProps({ staleOrders: [] })} />);
    expect(screen.getByText(/no stale orders/i)).toBeInTheDocument();
  });

  it('renders a stale order with a singular "1 day" label and no plural', () => {
    render(
      <HomeView
        {...baseProps({
          staleOrders: [{ ...order(), staleSince: '2026-07-09T12:00:00Z', daysStale: 1 }],
        })}
      />,
    );
    expect(screen.getByText(/quiet for 1 day$/)).toBeInTheDocument();
  });

  it('renders a stale order with a plural days label', () => {
    render(
      <HomeView
        {...baseProps({
          staleOrders: [{ ...order(), staleSince: '2026-07-05T12:00:00Z', daysStale: 5 }],
        })}
      />,
    );
    expect(screen.getByText(/quiet for 5 days/)).toBeInTheDocument();
  });

  it('shows the "Changes Requested" quick action only when there are changes-requested orders', () => {
    const { rerender } = render(<HomeView {...baseProps({ counts: { ...baseProps().counts, changesRequested: 0 } })} />);
    expect(screen.queryByRole('link', { name: /changes requested/i })).not.toBeInTheDocument();

    rerender(<HomeView {...baseProps({ counts: { ...baseProps().counts, changesRequested: 2 } })} />);
    expect(screen.getByRole('link', { name: /changes requested/i })).toBeInTheDocument();
  });

  it('shows the "no orders yet" empty state for Recent Orders', () => {
    render(<HomeView {...baseProps({ recentOrders: [] })} />);
    expect(screen.getByText('No orders yet')).toBeInTheDocument();
  });

  it('renders a recent order with a relative "time ago" trailing label', () => {
    render(
      <HomeView
        {...baseProps({
          recentOrders: [{ ...order(), createdAt: new Date(Date.now() - 5 * 60_000).toISOString() }],
        })}
      />,
    );

    expect(screen.getByText('Jane Coach')).toBeInTheDocument();
    expect(screen.getByText('Wildcats')).toBeInTheDocument();
    expect(screen.getByText('5m ago')).toBeInTheDocument();
  });

  it('renders recent orders using hours and days once old enough', () => {
    render(
      <HomeView
        {...baseProps({
          recentOrders: [
            { ...order({ id: 'o-1', orderNumber: 'OC-1' }), createdAt: new Date(Date.now() - 3 * 3_600_000).toISOString() },
            { ...order({ id: 'o-2', orderNumber: 'OC-2' }), createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString() },
          ],
        })}
      />,
    );

    expect(screen.getByText('3h ago')).toBeInTheDocument();
    expect(screen.getByText('2d ago')).toBeInTheDocument();
  });

  it('shows the "nothing due" empty state for Upcoming Deadlines', () => {
    render(<HomeView {...baseProps({ upcomingDeadlines: [] })} />);
    expect(screen.getByText(/nothing due in the next two weeks/i)).toBeInTheDocument();
  });

  it('shows a dash when an upcoming-deadline order has no deadline date', () => {
    render(
      <HomeView
        {...baseProps({
          upcomingDeadlines: [{ ...order(), deadlineDate: null, expectedShipDate: null }],
        })}
      />,
    );
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it.each([
    [-2, 'overdue by 2 days'],
    [0, 'due today'],
    [1, 'due tomorrow'],
    [5, 'due in 5 days'],
  ])('labels a deadline offset by %d days as "%s"', (offset, expected) => {
    render(
      <HomeView
        {...baseProps({
          upcomingDeadlines: [{ ...order(), deadlineDate: daysFromNow(offset), expectedShipDate: null }],
        })}
      />,
    );
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it('shows the "no holds" empty state for Colour Sample Holds', () => {
    render(<HomeView {...baseProps({ colorSampleHolds: [] })} />);
    expect(screen.getByText(/no orders currently on hold for colour matching/i)).toBeInTheDocument();
  });

  it('renders the colour sample holds count and list entries', () => {
    render(
      <HomeView
        {...baseProps({
          colorSampleHolds: [
            { ...order(), colorSampleRequestedAt: '2026-07-10T09:00:00Z' },
            { ...order(), id: 'order-2', orderNumber: 'OC-2', colorSampleRequestedAt: '2026-07-08T12:00:00Z' },
          ],
        })}
      />,
    );

    const cardTitle = screen.getByText('Colour Sample Holds', { selector: '.ant-card-head-title *' });
    const card = cardTitle.closest('.ant-card') as HTMLElement;
    expect(within(card).getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3h ago')).toBeInTheDocument();
    expect(screen.getByText('2d ago')).toBeInTheDocument();
  });

  it('hides the Failed Events widget entirely for a sales-role session', () => {
    render(<HomeView {...baseProps({ role: 'sales', failedEvents: [failedEvent()] })} />);
    expect(screen.queryByText('Failed Events')).not.toBeInTheDocument();
  });

  it('shows the "outbox is healthy" empty state for an admin with no failed events', () => {
    render(<HomeView {...baseProps({ role: 'admin', failedEvents: [] })} />);
    expect(screen.getByText(/the outbox is healthy/i)).toBeInTheDocument();
  });

  it('renders a failed event with its type, status tag, and attempt count', () => {
    render(
      <HomeView
        {...baseProps({
          role: 'admin',
          failedEvents: [failedEvent({ status: 'dead', attempts: 5 })],
        })}
      />,
    );

    expect(screen.getByText('order.confirmed')).toBeInTheDocument();
    expect(screen.getByText('dead')).toBeInTheDocument();
    expect(screen.getByText('5 attempts')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry now/i })).toBeInTheDocument();
  });

  it('retrying a failed event calls the retry endpoint and removes it from the list', async () => {
    vi.useRealTimers(); // userEvent's internal waits deadlock under fake timers
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) } as Response);
    render(
      <AntdApp>
        <HomeView
          {...baseProps({
            role: 'admin',
            failedEvents: [failedEvent({ id: 'event-7' })],
          })}
        />
      </AntdApp>,
    );

    await user.click(screen.getByRole('button', { name: /retry now/i }));

    expect(fetch).toHaveBeenCalledWith(
      '/api/admin/events/event-7/retry',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(await screen.findByText('Event queued for retry')).toBeInTheDocument();
    expect(screen.getByText(/the outbox is healthy/i)).toBeInTheDocument();
  });

  it('shows an error message when retrying fails, and keeps the event listed', async () => {
    vi.useRealTimers(); // userEvent's internal waits deadlock under fake timers
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Event not found or not failed/dead' }),
    } as Response);
    render(
      <AntdApp>
        <HomeView
          {...baseProps({
            role: 'admin',
            failedEvents: [failedEvent({ id: 'event-8' })],
          })}
        />
      </AntdApp>,
    );

    await user.click(screen.getByRole('button', { name: /retry now/i }));

    expect(await screen.findByText('Event not found or not failed/dead')).toBeInTheDocument();
    expect(screen.getByText('order.confirmed')).toBeInTheDocument();
  });
});

describe('HomeView — Stuck in Production', () => {
  const stuck = {
    entityId: 'e1',
    reference: 'OC-1001',
    stageSlug: 'artwork',
    hoursInStage: 120,
    urgency: 'warn' as const,
    orderId: 'o1',
  };

  it('shows an empty state when nothing is overdue', () => {
    render(<HomeView {...baseProps({ stuckInProduction: [] })} />);

    expect(screen.getByText(/nothing overdue/i)).toBeInTheDocument();
  });

  it('lists a stuck job with the stage it is waiting in', () => {
    render(<HomeView {...baseProps({ stuckInProduction: [stuck] })} />);

    expect(screen.getByText('OC-1001')).toBeInTheDocument();
    expect(screen.getByText('Waiting in artwork')).toBeInTheDocument();
    expect(screen.getByText('5 days')).toBeInTheDocument();
  });

  it('links to the order checklist, where the work actually is', () => {
    render(<HomeView {...baseProps({ stuckInProduction: [stuck] })} />);

    const link = screen.getAllByRole('link').find((a) => a.getAttribute('href')?.includes('o1'));
    expect(link).toHaveAttribute('href', '/admin/orders/o1?tab=checklist');
  });

  it('renders a purchase order with no resolvable parent without a link', () => {
    render(
      <HomeView
        {...baseProps({ stuckInProduction: [{ ...stuck, reference: 'PO-9', orderId: null }] })}
      />,
    );

    expect(screen.getByText('PO-9')).toBeInTheDocument();
  });
});
