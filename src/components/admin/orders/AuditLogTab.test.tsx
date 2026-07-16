import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuditLogTab } from './AuditLogTab';

function mockFetchOnce(events: unknown[]) {
  vi.mocked(fetch).mockResolvedValueOnce({
    ok: true,
    json: async () => ({ events }),
  } as Response);
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

describe('AuditLogTab', () => {
  it('fetches the audit log for the given order on mount', async () => {
    mockFetchOnce([]);
    render(<AuditLogTab orderId="order-1" />);

    expect(fetch).toHaveBeenCalledWith('/api/admin/orders/order-1/audit');
    await screen.findByText('No activity recorded yet.');
  });

  it('shows an empty state when there is no activity', async () => {
    mockFetchOnce([]);
    render(<AuditLogTab orderId="order-1" />);

    expect(await screen.findByText('No activity recorded yet.')).toBeInTheDocument();
  });

  it('shows an error alert when the fetch fails', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('network down'));
    render(<AuditLogTab orderId="order-1" />);

    expect(await screen.findByText('Failed to load audit log')).toBeInTheDocument();
  });

  it('renders a timeline entry with label and formatted date per event type', async () => {
    mockFetchOnce([
      {
        id: 'evt-1',
        eventType: 'token.generated',
        payload: {},
        status: 'delivered',
        createdAt: '2026-06-26T10:30:00Z',
      },
      {
        id: 'evt-2',
        eventType: 'order.confirmed',
        payload: {},
        status: 'delivered',
        createdAt: '2026-06-27T10:30:00Z',
      },
    ]);
    render(<AuditLogTab orderId="order-1" />);

    expect(await screen.findByText('Link generated')).toBeInTheDocument();
    expect(screen.getByText('Customer confirmed order')).toBeInTheDocument();
  });

  it('renders a label for the colour sample request event', async () => {
    mockFetchOnce([
      {
        id: 'evt-1',
        eventType: 'order.color_sample_requested',
        payload: {},
        status: 'delivered',
        createdAt: '2026-06-26T10:30:00Z',
      },
    ]);
    render(<AuditLogTab orderId="order-1" />);

    expect(await screen.findByText('Colour book / sample requested')).toBeInTheDocument();
  });

  it('renders a label for the colour sample resolved event', async () => {
    mockFetchOnce([
      {
        id: 'evt-1',
        eventType: 'order.color_sample_resolved',
        payload: {},
        status: 'delivered',
        createdAt: '2026-06-26T10:30:00Z',
      },
    ]);
    render(<AuditLogTab orderId="order-1" />);

    expect(await screen.findByText('Colour sample request resolved')).toBeInTheDocument();
  });

  it('falls back to the raw event type string for an unrecognized event', async () => {
    mockFetchOnce([
      { id: 'evt-1', eventType: 'some.future_event', payload: {}, status: 'delivered', createdAt: '2026-06-26T10:30:00Z' },
    ]);
    render(<AuditLogTab orderId="order-1" />);

    expect(await screen.findByText('some.future_event')).toBeInTheDocument();
  });

  it('renders the customer comment for a changes_requested event', async () => {
    mockFetchOnce([
      {
        id: 'evt-1',
        eventType: 'order.changes_requested',
        payload: { comment: 'Please make the jersey bigger' },
        status: 'delivered',
        createdAt: '2026-06-26T10:30:00Z',
      },
    ]);
    render(<AuditLogTab orderId="order-1" />);

    expect(await screen.findByText('Please make the jersey bigger')).toBeInTheDocument();
  });

  it('renders labels for team roster events, including the member name', async () => {
    mockFetchOnce([
      {
        id: 'evt-1',
        eventType: 'roster.member_added',
        payload: { name: 'Alex' },
        status: 'delivered',
        createdAt: '2026-06-26T10:30:00Z',
      },
      {
        id: 'evt-2',
        eventType: 'roster.locked',
        payload: {},
        status: 'delivered',
        createdAt: '2026-06-26T11:00:00Z',
      },
    ]);
    render(<AuditLogTab orderId="order-1" />);

    expect(await screen.findByText('Team member added')).toBeInTheDocument();
    expect(screen.getByText(/— Alex/)).toBeInTheDocument();
    expect(screen.getByText('Roster locked')).toBeInTheDocument();
  });

  it('renders actor email, recipient, resend marker, fields, and source order number from the payload', async () => {
    mockFetchOnce([
      {
        id: 'evt-1',
        eventType: 'link.emailed',
        payload: { actorEmail: 'sales@example.com', to: 'jane@example.com', orderStatus: 'changes_requested' },
        status: 'delivered',
        createdAt: '2026-06-26T10:30:00Z',
      },
      {
        id: 'evt-2',
        eventType: 'order.updated',
        payload: { fields: ['customerName', 'clubName'] },
        status: 'delivered',
        createdAt: '2026-06-26T11:00:00Z',
      },
      {
        id: 'evt-3',
        eventType: 'order.duplicated',
        payload: { sourceOrderNumber: 'OC-100' },
        status: 'delivered',
        createdAt: '2026-06-26T12:00:00Z',
      },
    ]);
    render(<AuditLogTab orderId="order-1" />);

    expect(await screen.findByText(/by sales@example\.com/)).toBeInTheDocument();
    expect(screen.getByText(/→ jane@example\.com/)).toBeInTheDocument();
    expect(screen.getByText(/re-sent after changes request/)).toBeInTheDocument();
    expect(screen.getByText(/customerName, clubName/)).toBeInTheDocument();
    expect(screen.getByText(/from OC-100/)).toBeInTheDocument();
  });
});
