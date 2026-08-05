import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import { installMockFetch, type MockRoute } from '@/test/mockFetch';
import { CreatePoModal, type PoModalGarment } from './CreatePoModal';

const SUPPLIERS_URL = '/api/admin/suppliers?active=1';
const CREATE_URL = '/api/admin/purchase-orders';

const UNCONFIRMED_WARNING = 'This order has not been confirmed by the customer.';
const COLOR_HOLD_WARNING = 'Colour sample requested — production is on hold.';

function suppliersRoute(): MockRoute {
  return {
    match: SUPPLIERS_URL,
    method: 'GET',
    response: [
      { id: 'f0e8b7a6-0000-4000-8000-000000000001', name: 'Acme Textiles' },
      { id: 'f0e8b7a6-0000-4000-8000-000000000002', name: 'Beta Garments' },
    ],
  };
}

/** Picking a supplier loads its colour books (newest first = default). */
function colorBooksRoute(items: Array<{ id: string; name: string; createdAt: string }> = []): MockRoute {
  return {
    match: /\/api\/admin\/suppliers\/[^/]+\/color-books$/,
    method: 'GET',
    response: { items },
  };
}

const TWO_BOOKS = [
  { id: 'cb-2026', name: 'Pantone 2026', createdAt: '2026-08-01T00:00:00Z' },
  { id: 'cb-2024', name: 'Pantone 2024', createdAt: '2024-08-01T00:00:00Z' },
];

const GARMENTS: PoModalGarment[] = [
  { id: 'g1', name: 'Jersey', sizingRowCount: 5, fullyCovered: true },
  { id: 'g2', name: 'Hoodie', sizingRowCount: 3, fullyCovered: false },
];

function renderModal(overrides: Partial<Parameters<typeof CreatePoModal>[0]> = {}) {
  return render(
    <AntdApp>
      <CreatePoModal
        open
        onClose={vi.fn()}
        onCreated={vi.fn()}
        orderId="order-1"
        orderStatus="confirmed"
        colorSampleRequestedAt={null}
        deadlineDate={null}
        garments={GARMENTS}
        {...overrides}
      />
    </AntdApp>,
  );
}

async function fillAndOpenSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('combobox'));
  await user.click(await screen.findByText('Acme Textiles'));
  await user.click(screen.getByText('Hoodie — 3 sizing rows'));
}

beforeEach(() => {
  // Default: any request throws loudly; tests install their own routes.
  installMockFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CreatePoModal', () => {
  it('shows no warnings for a confirmed order without a colour-sample hold', async () => {
    installMockFetch([suppliersRoute(), colorBooksRoute()]);
    renderModal();

    expect(await screen.findByText('Jersey — 5 sizing rows')).toBeInTheDocument();
    expect(screen.queryByText(UNCONFIRMED_WARNING)).not.toBeInTheDocument();
    expect(screen.queryByText(COLOR_HOLD_WARNING)).not.toBeInTheDocument();
  });

  it('warns when the order is not confirmed and gates submit behind a Popconfirm', async () => {
    const user = userEvent.setup();
    installMockFetch([suppliersRoute(), colorBooksRoute()]);
    renderModal({ orderStatus: 'sent' });

    expect(await screen.findByText(UNCONFIRMED_WARNING)).toBeInTheDocument();
    expect(screen.getByText(/supplier may start on unagreed details/i)).toBeInTheDocument();

    await fillAndOpenSubmit(user);
    await user.click(screen.getByRole('button', { name: 'Create purchase order' }));

    // No POST yet — the Popconfirm asks first.
    expect(await screen.findByText('Raise PO anyway?')).toBeInTheDocument();
  });

  it('shows the colour-sample hold error when a sample was requested', async () => {
    installMockFetch([suppliersRoute(), colorBooksRoute()]);
    renderModal({ colorSampleRequestedAt: '2026-07-01T00:00:00Z' });

    expect(await screen.findByText(COLOR_HOLD_WARNING)).toBeInTheDocument();
  });

  it('shows both warnings together for an unconfirmed order with a sample hold', async () => {
    installMockFetch([suppliersRoute(), colorBooksRoute()]);
    renderModal({ orderStatus: 'sent', colorSampleRequestedAt: '2026-07-01T00:00:00Z' });

    expect(await screen.findByText(UNCONFIRMED_WARNING)).toBeInTheDocument();
    expect(screen.getByText(COLOR_HOLD_WARNING)).toBeInTheDocument();
  });

  it('confirming the Popconfirm still raises the PO (warn, never block)', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const { fetchMock } = installMockFetch([
      suppliersRoute(),
      colorBooksRoute(),
      { match: CREATE_URL, method: 'POST', status: 201, response: { id: 'po-1', poNumber: 'PO-2607-AC01-X' } },
    ]);
    renderModal({ orderStatus: 'sent', onCreated });

    await fillAndOpenSubmit(user);
    await user.click(screen.getByRole('button', { name: 'Create purchase order' }));
    await user.click(await screen.findByRole('button', { name: 'Raise PO anyway' }));

    expect(await screen.findByText('Purchase order PO-2607-AC01-X created')).toBeInTheDocument();
    expect(onCreated).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(CREATE_URL, expect.objectContaining({ method: 'POST' }));
  });

  it('submits the createPurchaseOrderSchema body and reports the poNumber', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const { fetchMock } = installMockFetch([
      suppliersRoute(),
      colorBooksRoute(),
      { match: CREATE_URL, method: 'POST', status: 201, response: { id: 'po-1', poNumber: 'PO-2607-AC01-WILDCATS' } },
    ]);
    renderModal({ onCreated });

    await fillAndOpenSubmit(user);
    await user.type(
      screen.getByPlaceholderText(/shipping instructions/i),
      'Ship in one carton',
    );
    // Confirmed order, no hold — direct submit, no Popconfirm.
    await user.click(screen.getByRole('button', { name: 'Create purchase order' }));

    expect(await screen.findByText('Purchase order PO-2607-AC01-WILDCATS created')).toBeInTheDocument();
    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(postCall?.[0]).toBe(CREATE_URL);
    expect(JSON.parse(postCall![1]!.body as string)).toEqual({
      orderId: 'order-1',
      supplierId: 'f0e8b7a6-0000-4000-8000-000000000001',
      garmentIds: ['g2'],
      notes: 'Ship in one carton',
    });
    expect(onCreated).toHaveBeenCalled();
  });

  it('sends customerRef when a customer ref is typed (David, 2026-08-06)', async () => {
    const user = userEvent.setup();
    const { fetchMock } = installMockFetch([
      suppliersRoute(),
      colorBooksRoute(),
      { match: CREATE_URL, method: 'POST', status: 201, response: { id: 'po-1', poNumber: 'PO-1' } },
    ]);
    renderModal();

    await fillAndOpenSubmit(user);
    await user.type(
      screen.getByLabelText('Customer ref (for the PO title)'),
      'David Baird',
    );
    await user.click(screen.getByRole('button', { name: 'Create purchase order' }));

    expect(await screen.findByText('Purchase order PO-1 created')).toBeInTheDocument();
    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    // Sent raw — the server/display normalise to UPPERCASE-DASHED.
    expect(JSON.parse(postCall![1]!.body as string).customerRef).toBe('David Baird');
  });

  it('requires a supplier and at least one garment before POSTing', async () => {
    const user = userEvent.setup();
    const { fetchMock } = installMockFetch([suppliersRoute(), colorBooksRoute()]);
    renderModal();
    await screen.findByText('Jersey — 5 sizing rows');

    await user.click(screen.getByRole('button', { name: 'Create purchase order' }));
    expect(await screen.findByText('Select a supplier')).toBeInTheDocument();

    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByText('Acme Textiles'));
    await user.click(screen.getByRole('button', { name: 'Create purchase order' }));
    expect(await screen.findByText('Select at least one garment')).toBeInTheDocument();

    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posts).toHaveLength(0);
  });

  it('surfaces a 409 conflict message from the API', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    installMockFetch([
      suppliersRoute(),
      colorBooksRoute(),
      {
        match: CREATE_URL,
        method: 'POST',
        status: 409,
        response: { error: 'Supplier is inactive' },
      },
    ]);
    renderModal({ onCreated });

    await fillAndOpenSubmit(user);
    await user.click(screen.getByRole('button', { name: 'Create purchase order' }));

    expect(await screen.findByText('Supplier is inactive')).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
  });

  // The createPurchaseOrder required-options backstop (David, 2026-08-06) is a
  // 409 whose message lists the per-garment gaps — it must reach the staff eye
  // verbatim, or "create failed" gives them nothing to fix.
  it('surfaces the required-options 409 message listing the per-garment gaps', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    installMockFetch([
      suppliersRoute(),
      colorBooksRoute(),
      {
        match: CREATE_URL,
        method: 'POST',
        status: 409,
        response: { error: 'Required options not set — Shorts: Cord Color' },
      },
    ]);
    renderModal({ onCreated });

    await fillAndOpenSubmit(user);
    await user.click(screen.getByRole('button', { name: 'Create purchase order' }));

    expect(
      await screen.findByText('Required options not set — Shorts: Cord Color'),
    ).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('shows the customer deadline beside the ship date instead of a deadline picker', async () => {
    installMockFetch([suppliersRoute(), colorBooksRoute()]);
    renderModal({ deadlineDate: '2026-09-15' });
    await screen.findByText('Jersey — 5 sizing rows');

    // en-NZ short month renders "Sep" or "Sept" depending on ICU.
    expect(
      screen.getByText(/Customer deadline: 15 Sept? 2026 — imported to the PO automatically/),
    ).toBeInTheDocument();
    expect(screen.getByText('Required ship date')).toBeInTheDocument();
    expect(screen.queryByText('Deadline')).not.toBeInTheDocument();
  });

  it("says 'none set' when the order has no customer deadline", async () => {
    installMockFetch([suppliersRoute(), colorBooksRoute()]);
    renderModal();
    await screen.findByText('Jersey — 5 sizing rows');

    expect(
      screen.getByText(/Customer deadline: none set — imported to the PO automatically/),
    ).toBeInTheDocument();
  });

  it('marks fully covered garments with a covered hint', async () => {
    installMockFetch([suppliersRoute(), colorBooksRoute()]);
    renderModal();

    expect(await screen.findByText('Jersey — 5 sizing rows')).toBeInTheDocument();
    expect(screen.getAllByText('(already covered)')).toHaveLength(1);
  });

  it('defaults to the newest colour book and OMITS colorBookId from the body', async () => {
    const user = userEvent.setup();
    const { fetchMock } = installMockFetch([
      suppliersRoute(),
      colorBooksRoute(TWO_BOOKS),
      { match: CREATE_URL, method: 'POST', status: 201, response: { id: 'po-1', poNumber: 'PO-1' } },
    ]);
    renderModal();

    await fillAndOpenSubmit(user);
    // The newest book is auto-selected and flagged as the latest.
    expect(await screen.findByText('Pantone 2026 (latest)')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Create purchase order' }));

    expect(await screen.findByText('Purchase order PO-1 created')).toBeInTheDocument();
    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    // Default pick = omitted — the server resolves the supplier's newest itself.
    expect('colorBookId' in JSON.parse(postCall![1]!.body as string)).toBe(false);
  });

  it('sends colorBookId when an older colour book is picked', async () => {
    const user = userEvent.setup();
    const { fetchMock } = installMockFetch([
      suppliersRoute(),
      colorBooksRoute(TWO_BOOKS),
      { match: CREATE_URL, method: 'POST', status: 201, response: { id: 'po-1', poNumber: 'PO-1' } },
    ]);
    renderModal();

    await fillAndOpenSubmit(user);
    await user.click(await screen.findByRole('combobox', { name: 'Colour book' }));
    await user.click(await screen.findByText('Pantone 2024'));
    await user.click(screen.getByRole('button', { name: 'Create purchase order' }));

    expect(await screen.findByText('Purchase order PO-1 created')).toBeInTheDocument();
    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(postCall![1]!.body as string).colorBookId).toBe('cb-2024');
  });

  it('adds a new colour book inline; it becomes the default and is omitted from the body', async () => {
    const user = userEvent.setup();
    const { fetchMock } = installMockFetch([
      suppliersRoute(),
      colorBooksRoute(TWO_BOOKS),
      {
        match: /\/api\/admin\/suppliers\/[^/]+\/color-books$/,
        method: 'POST',
        status: 201,
        response: { id: 'cb-2027', name: 'Pantone 2027', createdAt: '2026-08-05T00:00:00Z' },
      },
      { match: CREATE_URL, method: 'POST', status: 201, response: { id: 'po-1', poNumber: 'PO-1' } },
    ]);
    renderModal();

    await fillAndOpenSubmit(user);
    await user.click(await screen.findByRole('button', { name: /add new book/i }));
    await user.type(screen.getByLabelText('New colour book name'), 'Pantone 2027');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(
      await screen.findByText(/"Pantone 2027" added — it is now this supplier's default/),
    ).toBeInTheDocument();
    const bookPost = fetchMock.mock.calls.find(
      ([url, init]) => init?.method === 'POST' && String(url).endsWith('/color-books'),
    );
    expect(JSON.parse(bookPost![1]!.body as string)).toEqual({ name: 'Pantone 2027' });

    await user.click(screen.getByRole('button', { name: 'Create purchase order' }));
    expect(await screen.findByText('Purchase order PO-1 created')).toBeInTheDocument();
    const createCall = fetchMock.mock.calls.find(
      ([url, init]) => init?.method === 'POST' && url === CREATE_URL,
    );
    // The new book IS the supplier's newest now, so the default is omitted.
    expect('colorBookId' in JSON.parse(createCall![1]!.body as string)).toBe(false);
  });
});
