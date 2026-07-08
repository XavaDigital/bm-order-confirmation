import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CustomerOrderView, type CustomerOrderViewProps } from './view';

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt={props.alt as string} {...props} />;
  },
}));

vi.mock('react-signature-canvas', () => ({
  default: () => <div data-testid="signature-canvas" />,
}));

// The component calls the antd static `message` API (not App.useApp()), which
// mounts its holder outside the component tree in a way that isn't reliably
// visible to jsdom/RTL. Spy on it directly instead of asserting on rendered text.
const { messageError } = vi.hoisted(() => ({ messageError: vi.fn() }));
vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>();
  return { ...actual, message: { ...actual.message, error: messageError } };
});

function baseOrder(overrides: Partial<CustomerOrderViewProps['order']> = {}): CustomerOrderViewProps['order'] {
  return {
    id: 'order-1',
    orderNumber: 'OC-1',
    customerName: 'Jane Coach',
    customerEmail: 'jane@example.com',
    clubName: 'Wildcats',
    status: 'sent',
    orderValueAmount: '1500.00',
    orderValueCurrency: 'NZD',
    invoiceUrl: null,
    expectedShipDate: null,
    deadlineDate: null,
    generalNotes: null,
    shippingMode: 'later',
    shippingAddress: null,
    garments: [
      {
        id: 'garment-1',
        name: 'Home Jersey',
        fabrics: [],
        notes: null,
        sizing: [],
        images: [],
        sizeCharts: [],
      },
    ],
    ...overrides,
  };
}

function renderView(order: CustomerOrderViewProps['order']) {
  return render(<CustomerOrderView token="raw-token" order={order} />);
}

async function checkAllAcknowledgments(user: ReturnType<typeof userEvent.setup>) {
  const checkboxes = screen.getAllByRole('checkbox');
  for (const box of checkboxes) {
    await user.click(box);
  }
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  messageError.mockClear();
});

describe('CustomerOrderView', () => {
  it('shows the already-confirmed panel and no form when the order is already confirmed', () => {
    renderView(baseOrder({ status: 'confirmed' }));

    expect(screen.getByText('Order Confirmed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /confirm order/i })).not.toBeInTheDocument();
  });

  it('renders the order header and garment details, with the Confirm button disabled until all acks are checked', () => {
    renderView(baseOrder());

    expect(screen.getByRole('heading', { name: 'OC-1' })).toBeInTheDocument();
    expect(screen.getByText(/home jersey/i)).toBeInTheDocument();
    expect(screen.getByText(/please tick all 7 acknowledgments/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirm order/i })).toBeDisabled();
  });

  it('shows a print-accuracy disclaimer under mock-up images but not when a garment has none', () => {
    renderView(
      baseOrder({
        garments: [
          {
            id: 'garment-1',
            name: 'Home Jersey',
            fabrics: [],
            notes: null,
            sizing: [],
            images: [{ id: 'img-1', caption: null, url: 'https://example.com/mockup.png' }],
            sizeCharts: [],
          },
          {
            id: 'garment-2',
            name: 'Shorts',
            fabrics: [],
            notes: null,
            sizing: [],
            images: [],
            sizeCharts: [],
          },
        ],
      }),
    );

    expect(screen.getAllByText(/may appear slightly different in person/i)).toHaveLength(1);
  });

  it('enables the Confirm button once all acknowledgments are checked', async () => {
    const user = userEvent.setup();
    renderView(baseOrder());

    await checkAllAcknowledgments(user);

    expect(screen.getByRole('button', { name: /confirm order/i })).toBeEnabled();
  });

  it('confirming submits acknowledgments to /api/o/confirm and shows the success panel', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ orderNumber: 'OC-1', confirmedAt: '2026-01-15T10:30:00Z' }),
    } as Response);
    renderView(baseOrder());

    await checkAllAcknowledgments(user);
    await user.click(screen.getByRole('button', { name: /confirm order/i }));
    await user.click(await screen.findByRole('button', { name: /yes, confirm/i }));

    expect(fetch).toHaveBeenCalledWith(
      '/api/o/confirm',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(body.token).toBe('raw-token');
    expect(body.acknowledgments).toHaveLength(7);

    expect(await screen.findByText('Confirmed')).toBeInTheDocument();
    expect(screen.getByText('OC-1')).toBeInTheDocument();
  });

  it('treats a 409 already_confirmed race as success and shows the success panel', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: 'Already confirmed', code: 'already_confirmed' }),
    } as Response);
    renderView(baseOrder());

    await checkAllAcknowledgments(user);
    await user.click(screen.getByRole('button', { name: /confirm order/i }));
    await user.click(await screen.findByRole('button', { name: /yes, confirm/i }));

    expect(await screen.findByText('Confirmed')).toBeInTheDocument();
  });

  it('shows an error message and stays on the form when confirmation fails', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Something broke' }),
    } as Response);
    renderView(baseOrder());

    await checkAllAcknowledgments(user);
    await user.click(screen.getByRole('button', { name: /confirm order/i }));
    await user.click(await screen.findByRole('button', { name: /yes, confirm/i }));

    await vi.waitFor(() => expect(messageError).toHaveBeenCalledWith('Something broke'));
    expect(screen.getByRole('heading', { name: 'OC-1' })).toBeInTheDocument();
  });

  it('requesting changes opens the modal, submits a comment, and shows the changes-requested panel', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, orderNumber: 'OC-1' }),
    } as Response);
    renderView(baseOrder());

    await user.click(screen.getByRole('button', { name: /request changes/i }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByPlaceholderText(/the sizing for jersey/i), 'Please make it bigger');
    await user.click(within(dialog).getByRole('button', { name: /submit request/i }));

    expect(fetch).toHaveBeenCalledWith('/api/o/request-changes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'raw-token', comment: 'Please make it bigger' }),
    });
    expect(await screen.findByText('Changes Requested')).toBeInTheDocument();
  });

  it('disables the Submit Request button until a comment is entered', async () => {
    const user = userEvent.setup();
    renderView(baseOrder());

    await user.click(screen.getByRole('button', { name: /request changes/i }));
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByRole('button', { name: /submit request/i })).toBeDisabled();
  });
});
