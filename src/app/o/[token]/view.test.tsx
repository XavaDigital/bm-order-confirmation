import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
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
    colorSampleRequested: false,
    rosterSummary: { total: 0, submitted: 0, pending: 0 },
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

// antd's Modal leave-transition (content zoom + mask fade) waits for real
// transitionend events before unmounting, which jsdom never dispatches on its
// own — sweep for the leaving nodes and fire it manually, retrying until the
// dialog is actually gone since the "leave-active" class lands a tick late.
async function waitForModalToClose() {
  await vi.waitFor(() => {
    document
      .querySelectorAll('.ant-zoom-leave-active, .ant-fade-leave-active')
      .forEach((el) => fireEvent.transitionEnd(el));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
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

  it('shows a non-blocking banner when roster members are still pending', () => {
    renderView(baseOrder({ rosterSummary: { total: 4, submitted: 1, pending: 3 } }));

    expect(screen.getByText("3 team members have not submitted a size yet.")).toBeInTheDocument();
    expect(
      screen.getByText(/you can still confirm this order now/i),
    ).toBeInTheDocument();
  });

  it('shows a source tag on sizing rows submitted through the team roster', () => {
    renderView(
      baseOrder({
        garments: [
          {
            id: 'garment-1',
            name: 'Home Jersey',
            fabrics: [],
            notes: null,
            sizing: [
              {
                size: 'M',
                playerName: 'Alex Player',
                playerNumber: '7',
                notes: null,
                viaTeamRoster: true,
              },
            ],
            images: [],
            sizeCharts: [],
          },
        ],
      }),
    );

    expect(screen.getByText('via team roster')).toBeInTheDocument();
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
    expect(body.colorSampleRequested).toBeUndefined();

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

  it('shows an informational note about colour matching that is not a checkbox and does not block confirming', () => {
    renderView(baseOrder());

    expect(
      screen.getByText(/must request a colour book or physical sample for matching/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /colour/i })).not.toBeInTheDocument();
  });

  it('requesting a colour sample opens a confirm modal, posts to the dedicated endpoint, and disables the action', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, orderNumber: 'OC-1' }),
    } as Response);
    renderView(baseOrder());

    await user.click(screen.getByRole('button', { name: /request colour sample/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/production will be held/i)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /yes, request sample/i }));

    expect(fetch).toHaveBeenCalledWith('/api/o/request-color-sample', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'raw-token' }),
    });

    expect(await screen.findByRole('button', { name: /sample requested/i })).toBeDisabled();
  });

  it('shows the action as already requested on load when the order prop says so', () => {
    renderView(baseOrder({ colorSampleRequested: true }));

    expect(screen.getByRole('button', { name: /sample requested/i })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /^request colour sample$/i })).not.toBeInTheDocument();
  });

  it('shows an error message and leaves the action available when the colour-sample request fails', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Something broke' }),
    } as Response);
    renderView(baseOrder());

    await user.click(screen.getByRole('button', { name: /request colour sample/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /yes, request sample/i }));

    await vi.waitFor(() => expect(messageError).toHaveBeenCalledWith('Something broke'));
    expect(screen.getByRole('button', { name: /request colour sample/i })).toBeEnabled();
  });

  it('renders a tag per fabric on a garment', () => {
    renderView(
      baseOrder({
        garments: [
          {
            id: 'garment-1',
            name: 'Home Jersey',
            fabrics: ['Polyester', 'Spandex'],
            notes: null,
            sizing: [],
            images: [],
            sizeCharts: [],
          },
        ],
      }),
    );

    expect(screen.getByText('Polyester')).toBeInTheDocument();
    expect(screen.getByText('Spandex')).toBeInTheDocument();
  });

  it('a size-chart tag with a signed URL opens a PDF preview in an iframe with a download link', async () => {
    const user = userEvent.setup();
    renderView(
      baseOrder({
        garments: [
          {
            id: 'garment-1',
            name: 'Home Jersey',
            fabrics: [],
            notes: null,
            sizing: [],
            images: [],
            sizeCharts: [
              {
                name: 'Adult Chart',
                storageKey: 'charts/adult.pdf',
                url: 'https://signed.example.com/adult.pdf',
                downloadUrl: 'https://signed.example.com/adult.pdf?dl=1',
              },
            ],
          },
        ],
      }),
    );

    await user.click(screen.getByText('Adult Chart'));

    const dialog = await screen.findByRole('dialog');
    const iframe = within(dialog).getByTitle('Adult Chart') as HTMLIFrameElement;
    expect(iframe.tagName).toBe('IFRAME');
    expect(iframe.src).toBe('https://signed.example.com/adult.pdf');
    expect(within(dialog).getByRole('link', { name: /download/i })).toHaveAttribute(
      'href',
      'https://signed.example.com/adult.pdf?dl=1',
    );
  });

  it('a size-chart tag for a non-PDF image opens a preview with no download link when none is available', async () => {
    const user = userEvent.setup();
    renderView(
      baseOrder({
        garments: [
          {
            id: 'garment-1',
            name: 'Home Jersey',
            fabrics: [],
            notes: null,
            sizing: [],
            images: [],
            sizeCharts: [
              {
                name: 'Kids Chart',
                storageKey: 'charts/kids.png',
                url: 'https://signed.example.com/kids.png',
                downloadUrl: null,
              },
            ],
          },
        ],
      }),
    );

    await user.click(screen.getByText('Kids Chart'));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByAltText('Kids Chart')).toBeInTheDocument();
    expect(within(dialog).queryByRole('link', { name: /download/i })).not.toBeInTheDocument();
  });

  it('typing into Concerns and a customer-entered shipping address are included in the confirm payload', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ orderNumber: 'OC-1', confirmedAt: '2026-01-15T10:30:00Z' }),
    } as Response);
    renderView(baseOrder({ shippingMode: 'customer_entered' }));

    await user.type(
      screen.getByPlaceholderText(/any concerns or comments/i),
      'Please double check the sizing',
    );
    await user.type(screen.getByPlaceholderText('123 Main Street'), '456 Side Street');
    await user.type(screen.getByLabelText('City'), 'Wellington');
    await checkAllAcknowledgments(user);
    await user.click(screen.getByRole('button', { name: /confirm order/i }));
    await user.click(await screen.findByRole('button', { name: /yes, confirm/i }));

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(body.concerns).toBe('Please double check the sizing');
    expect(body.shippingAddress).toMatchObject({ line1: '456 Side Street', city: 'Wellington' });
  });

  it('canceling the Request Changes modal closes it without submitting', async () => {
    const user = userEvent.setup();
    renderView(baseOrder());

    await user.click(screen.getByRole('button', { name: /request changes/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^cancel$/i }));
    await waitForModalToClose();

    expect(fetch).not.toHaveBeenCalled();
  });

  it('closing the size-chart preview modal hides it', async () => {
    const user = userEvent.setup();
    renderView(
      baseOrder({
        garments: [
          {
            id: 'garment-1',
            name: 'Home Jersey',
            fabrics: [],
            notes: null,
            sizing: [],
            images: [],
            sizeCharts: [
              {
                name: 'Adult Chart',
                storageKey: 'charts/adult.pdf',
                url: 'https://signed.example.com/adult.pdf',
                downloadUrl: null,
              },
            ],
          },
        ],
      }),
    );

    await user.click(screen.getByText('Adult Chart'));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitForModalToClose();
  });

  it('a size-chart tag with no signed URL is not clickable and opens no preview', async () => {
    const user = userEvent.setup();
    renderView(
      baseOrder({
        garments: [
          {
            id: 'garment-1',
            name: 'Home Jersey',
            fabrics: [],
            notes: null,
            sizing: [],
            images: [],
            sizeCharts: [
              { name: 'Unavailable Chart', storageKey: null, url: null, downloadUrl: null },
            ],
          },
        ],
      }),
    );

    await user.click(screen.getByText('Unavailable Chart'));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
