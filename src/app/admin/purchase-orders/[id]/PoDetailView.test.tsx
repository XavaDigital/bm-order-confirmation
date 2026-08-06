import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import { installMockFetch, type MockRoute } from '@/test/mockFetch';
import { PoDetailView } from './PoDetailView';

/** Type into a RichTextEditor contenteditable (NotesThread.test's pattern). */
async function writeInEditor(label: string, html: string) {
  const editor = await screen.findByRole('textbox', { name: label });
  editor.innerHTML = html;
  // React listens for `input` on contenteditable; dispatching it is what a
  // real keystroke would do.
  fireEvent.input(editor);
  return editor;
}

const PO_ID = 'po-1';

function snapshot() {
  return {
    orderNumber: 'BM-1042',
    garments: [
      {
        garmentId: 'g1',
        name: 'Team Hoodie',
        garmentTypeId: null,
        garmentTypeName: 'Hoodie',
        fabrics: [],
        selectedFabrics: null,
        selectedOptions: null,
        notes: null,
        lines: [
          { sizingRowId: 'row-1', size: 'M', playerName: 'Alice', playerNumber: '7', notes: null },
          { sizingRowId: 'row-2', size: 'M', playerName: 'Bob', playerNumber: null, notes: null },
          { sizingRowId: 'row-3', size: 'L', playerName: null, playerNumber: null, notes: null },
        ],
      },
    ],
  };
}

function detail(overrides: Record<string, unknown> = {}) {
  return {
    id: PO_ID,
    poNumber: 'PO-2607-VA01-JANECOACH',
    // Defaults keep the DISPLAY title equal to the poNumber (no ref, not yet
    // sent) so header assertions stay unambiguous; the display-title tests
    // override customerRef/sentAt explicitly.
    customerRef: null,
    orderId: 'order-1',
    status: 'sent',
    currentRevisionNumber: 1,
    deadlineDate: '2026-09-15',
    expectedShipDate: null,
    actualShipDate: null,
    sentAt: null,
    receivedAt: null,
    notes: null,
    createdAt: '2026-07-18T10:00:00Z',
    colorBookId: null,
    colorBookName: null,
    supplier: {
      id: 'sup-1',
      name: 'Vast Apparel',
      contactPerson: 'Li Wei',
      email: 'factory@example.com',
      phone: null,
    },
    order: {
      id: 'order-1',
      orderNumber: 'BM-1042',
      customerName: 'Jane Coach',
      status: 'confirmed',
      deadlineDate: '2026-09-15',
    },
    revisions: [
      {
        id: 'rev-1',
        revisionNumber: 1,
        reason: null,
        snapshot: snapshot(),
        createdAt: '2026-07-18T10:00:00Z',
      },
    ],
    shipments: [],
    supplierLink: { active: false, lastViewedAt: null },
    portalUrl: 'https://orders.example.com/supplier/VA/PO-2607-VA01-JANECOACH',
    history: [],
    ...overrides,
  };
}

function noVarianceSummary() {
  return {
    purchaseOrders: [
      {
        id: PO_ID,
        variance: { garments: [], hasVariance: false },
        varianceCounts: { added: 0, modified: 0, removed: 0 },
      },
    ],
  };
}

function varianceSummary() {
  return {
    purchaseOrders: [
      {
        id: PO_ID,
        variance: {
          hasVariance: true,
          garments: [
            {
              garmentId: 'g1',
              name: 'Team Hoodie',
              status: 'modified',
              fieldChanges: [],
              lines: [
                {
                  sizingRowId: 'row-4',
                  change: 'added',
                  line: { sizingRowId: 'row-4', size: 'XL', playerName: 'Zoe', playerNumber: null, notes: null },
                },
                {
                  sizingRowId: 'row-1',
                  change: 'modified',
                  fieldChanges: [{ field: 'size', from: 'M', to: 'S' }],
                  line: { sizingRowId: 'row-1', size: 'S', playerName: 'Alice', playerNumber: '7', notes: null },
                },
              ],
            },
          ],
        },
        varianceCounts: { added: 1, modified: 1, removed: 0 },
      },
    ],
  };
}

/** A checklist row (GET /checklist shape); the base mock serves an empty list. */
function checklistItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'chk-1',
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

function sendPreview() {
  return {
    to: 'factory@example.com',
    toName: 'Li Wei',
    subject: 'Purchase order PO-2607-VA01-JANECOACH — BeastMode',
    html: '<!DOCTYPE html><html><body><p>Hi Li Wei,</p></body></html>',
    portalUrl: 'https://orders.example.com/supplier/VA/PO-2607-VA01-JANECOACH',
    attachments: [{ filename: 'PO-2607-VA01-JANECOACH.pdf' }, { filename: 'PO-2607-VA01-JANECOACH.xlsx' }],
  };
}

function baseRoutes(
  d = detail(),
  summary: unknown = noVarianceSummary(),
  opts: {
    portalPassword?: string | null;
    comments?: unknown[];
    orderNotes?: unknown[];
    checklist?: unknown[];
  } = {},
): MockRoute[] {
  return [
    { match: `/api/admin/purchase-orders/${PO_ID}`, method: 'GET', response: d },
    // The production-files card fetches on mount.
    {
      match: `/api/admin/purchase-orders/${PO_ID}/files`,
      method: 'GET',
      response: { items: [] },
    },
    // The pre-send checklist card fetches on mount too.
    {
      match: `/api/admin/purchase-orders/${PO_ID}/checklist`,
      method: 'GET',
      response: { items: opts.checklist ?? [] },
    },
    { match: /\/api\/admin\/orders\/order-1\/purchase-orders/, method: 'GET', response: summary },
    {
      match: '/api/admin/suppliers/sup-1',
      method: 'GET',
      // `in` rather than `??` — an explicit null (portal closed) must survive.
      response: {
        id: 'sup-1',
        portalPassword: 'portalPassword' in opts ? opts.portalPassword : 'hunter22',
      },
    },
    {
      match: '/api/admin/orders/order-1/notes',
      method: 'GET',
      response: opts.comments ?? [],
    },
    {
      match: '/api/admin/orders/order-1/notes?kind=note',
      method: 'GET',
      response: opts.orderNotes ?? [],
    },
  ];
}

function note(overrides: Record<string, unknown> = {}) {
  return {
    id: 'note-1',
    body: 'Please double-box the hoodies',
    authorKind: 'staff',
    authorName: 'Dana Sales',
    authorEmail: 'dana@example.com',
    authorLabel: null,
    visibility: 'shared',
    deleted: false,
    createdAt: '2026-07-21T10:00:00Z',
    ...overrides,
  };
}

function renderView() {
  return render(
    <AntdApp>
      <PoDetailView poId={PO_ID} />
    </AntdApp>,
  );
}

beforeEach(() => {
  installMockFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PoDetailView', () => {
  // David's 2026-08-06 round-three layout: the two-column row spreads to
  // 1600px with a fluid main column (rail pinned right), garment details are
  // genuinely two-column, and the type hierarchy steps garment name > card
  // titles > section labels. Mirrored on OrderDetailView.
  describe('layout (round three)', () => {
    it('caps the two-column row at 1600px with a fluid main column', async () => {
      installMockFetch(baseRoutes());
      renderView();
      await screen.findByText('PO-2607-VA01-JANECOACH');

      const layout = screen.getByTestId('detail-layout');
      expect(layout).toHaveStyle({ maxWidth: '1600px' });
      // The main column flexes to fill — the old 1100px cap is gone.
      expect(layout.firstElementChild).not.toHaveStyle({ maxWidth: '1100px' });
    });

    it('renders Fabrics and Options as two columns with fabric entries stacked one per line', async () => {
      const snap = snapshot();
      snap.garments[0] = {
        ...snap.garments[0],
        selectedFabrics: { Body: 'Dri-fit', Hood: 'Cotton fleece' },
        selectedOptions: { Collar: 'V-neck' },
      } as unknown as (typeof snap.garments)[0];
      installMockFetch(
        baseRoutes(
          detail({
            revisions: [
              {
                id: 'rev-1',
                revisionNumber: 1,
                reason: null,
                snapshot: snap,
                createdAt: '2026-07-18T10:00:00Z',
              },
            ],
          }),
        ),
      );
      renderView();

      expect(await screen.findByText('Fabrics')).toBeInTheDocument();
      // ONE grid holds both sections — Fabrics left, Options right.
      const columns = screen.getByTestId('garment-details-g1');
      expect(columns).toHaveStyle({ display: 'grid' });
      expect(within(columns).getByText('Fabrics')).toBeInTheDocument();
      expect(within(columns).getByText('Options')).toBeInTheDocument();
      // The two fabrics stack within the Fabrics section, one per line.
      expect(screen.getByText('Body: Dri-fit')).toHaveStyle({ display: 'block' });
      expect(screen.getByText('Hood: Cotton fleece')).toHaveStyle({ display: 'block' });
    });

    it('steps the type hierarchy: garment name, then card titles, then section labels', async () => {
      installMockFetch(baseRoutes());
      renderView();

      // The garment NAME dominates its section (18px/700). Text strong nests
      // a <strong>; the inline style sits on the outer typography span.
      const name = await screen.findByText('Team Hoodie');
      expect(name.closest('.ant-typography')).toHaveStyle({
        fontSize: '18px',
        fontWeight: '700',
      });
      // ...card titles outrank the text inside them (16px/600)...
      for (const title of ['Summary', 'Dates', 'Shipments', 'Internal order notes', 'Comments']) {
        expect(screen.getByText(title).closest('.ant-card-head')).toHaveStyle({
          fontSize: '16px',
          fontWeight: '600',
        });
      }
      // ...and section labels carry the faint underline capped at half width.
      expect(screen.getByText('Sizing').closest('div')).toHaveStyle({ maxWidth: '50%' });
    });
  });

  it('renders the header with PO number, status badge, revision tag and actions', async () => {
    installMockFetch(baseRoutes());
    renderView();

    expect(await screen.findByText('PO-2607-VA01-JANECOACH')).toBeInTheDocument();
    // 'sent' renders as Unconfirmed (poStatusMeta).
    expect(screen.getByText('Unconfirmed')).toBeInTheDocument();
    expect(screen.getByText('v1')).toBeInTheDocument();

    const sendButton = screen.getByRole('button', { name: /send to supplier/i });
    expect(sendButton).toBeEnabled();
    const pdfLink = screen.getByRole('button', { name: /download pdf/i }).closest('a');
    expect(pdfLink).toHaveAttribute('href', `/api/admin/purchase-orders/${PO_ID}/pdf`);
    expect(screen.getByRole('button', { name: /advance status/i })).toBeInTheDocument();
  });

  it('offers ONLY the legal status transitions in the Advance status dropdown', async () => {
    const user = userEvent.setup();
    installMockFetch(baseRoutes());
    renderView();
    await screen.findByText('PO-2607-VA01-JANECOACH');

    await user.click(screen.getByRole('button', { name: /advance status/i }));

    const menu = await screen.findByRole('menu');
    // From 'sent': the full forward production chain + cancel...
    for (const label of [
      'Confirmed',
      'Design prep',
      'Test print',
      'Prod layout',
      'Production',
      'Quality control',
      'Shipping',
      'Received',
      'Completed',
      'Cancelled',
    ]) {
      expect(within(menu).getByText(label)).toBeInTheDocument();
    }
    // ...but never backwards or into remake from 'sent'.
    expect(within(menu).queryByText('Draft')).not.toBeInTheDocument();
    // `approved` displays as "Review" (David, 2026-08-06).
    expect(within(menu).queryByText('Review')).not.toBeInTheDocument();
    expect(within(menu).queryByText('Remake')).not.toBeInTheDocument();
  });

  it('posts a legal transition and reloads', async () => {
    const user = userEvent.setup();
    const { fetchMock, addRoute } = installMockFetch(baseRoutes());
    addRoute({
      match: `/api/admin/purchase-orders/${PO_ID}/status`,
      method: 'POST',
      response: { ok: true },
    });
    renderView();
    await screen.findByText('PO-2607-VA01-JANECOACH');

    await user.click(screen.getByRole('button', { name: /advance status/i }));
    await user.click(await screen.findByText('Production'));

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/admin/purchase-orders/${PO_ID}/status`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ status: 'in_production' }),
        }),
      );
    });
  });

  it('disables Send to supplier when the supplier has no email address', async () => {
    installMockFetch(
      baseRoutes(detail({ supplier: { id: 'sup-1', name: 'Vast Apparel', contactPerson: null, email: null, phone: null } })),
    );
    renderView();
    await screen.findByText('PO-2607-VA01-JANECOACH');

    expect(screen.getByRole('button', { name: /send to supplier/i })).toBeDisabled();
  });

  it('sends via the preview modal — shows the composed email, sends with the typed intro, and surfaces the response', async () => {
    const user = userEvent.setup();
    const { fetchMock, addRoute } = installMockFetch(baseRoutes());
    addRoute({
      match: `/api/admin/purchase-orders/${PO_ID}/send-preview`,
      method: 'GET',
      response: sendPreview(),
    });
    addRoute({
      match: `/api/admin/purchase-orders/${PO_ID}/send`,
      method: 'POST',
      response: {
        ok: true,
        poNumber: 'PO-2607-VA01-JANECOACH',
        to: 'factory@example.com',
        attachmentSummary: { images: 2, fonts: 1, sizeCharts: 1, sizeReduced: false },
      },
    });
    renderView();
    await screen.findByText('PO-2607-VA01-JANECOACH');

    await user.click(screen.getByRole('button', { name: /send to supplier/i }));

    // The modal previews what's actually being sent before anything fires.
    expect(await screen.findByText(/Li Wei <factory@example.com>/)).toBeInTheDocument();
    expect(screen.getByText('PO-2607-VA01-JANECOACH.pdf')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Message to the supplier'), 'Ship by Friday');
    await user.click(screen.getByRole('button', { name: /send email/i }));

    await vi.waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([url, init]) =>
          url === `/api/admin/purchase-orders/${PO_ID}/send` && init?.method === 'POST',
      );
      expect(post).toBeTruthy();
      expect(JSON.parse(post![1]!.body as string)).toEqual({ messageIntro: 'Ship by Friday' });
    });
    expect(await screen.findByText(/emailed to factory@example.com/i)).toBeInTheDocument();
  });

  it('surfaces the 503 email-unconfigured message inside the send modal', async () => {
    const user = userEvent.setup();
    const { addRoute } = installMockFetch(baseRoutes());
    addRoute({
      match: `/api/admin/purchase-orders/${PO_ID}/send-preview`,
      method: 'GET',
      response: sendPreview(),
    });
    addRoute({
      match: `/api/admin/purchase-orders/${PO_ID}/send`,
      method: 'POST',
      status: 503,
      response: { error: 'Email delivery is not configured on this server.' },
    });
    renderView();
    await screen.findByText('PO-2607-VA01-JANECOACH');

    await user.click(screen.getByRole('button', { name: /send to supplier/i }));
    await user.click(await screen.findByRole('button', { name: /send email/i }));

    expect(
      await screen.findByText('Email delivery is not configured on this server.'),
    ).toBeInTheDocument();
  });

  it('renders the pre-send checklist card above the internal order notes with its items', async () => {
    installMockFetch(
      baseRoutes(detail(), noVarianceSummary(), {
        checklist: [
          checklistItem({
            id: 'chk-auto',
            label: 'At least one design file attached',
            autoRule: 'design_file_attached',
            satisfied: true,
            auto: true,
          }),
          checklistItem(),
        ],
      }),
    );
    renderView();

    expect(await screen.findByText('Pre-send checklist')).toBeInTheDocument();
    expect(screen.getByTestId('checklist-progress')).toHaveTextContent('1 of 2 complete');
    expect(screen.getByText('auto')).toBeInTheDocument();
    // Above "Internal order notes" in the right rail.
    const cards = screen.getAllByText(/Pre-send checklist|Internal order notes/);
    expect(cards[0]).toHaveTextContent('Pre-send checklist');
  });

  it('ticks a manual checklist item from the card', async () => {
    const user = userEvent.setup();
    const { fetchMock, addRoute } = installMockFetch(
      baseRoutes(detail(), noVarianceSummary(), { checklist: [checklistItem()] }),
    );
    addRoute({
      match: `/api/admin/purchase-orders/${PO_ID}/checklist`,
      method: 'POST',
      response: {
        items: [
          checklistItem({
            satisfied: true,
            checkedByEmail: 'staff@example.com',
            checkedAt: '2026-08-06T10:00:00Z',
          }),
        ],
      },
    });
    renderView();
    await screen.findByText('Design file includes colours');

    await user.click(screen.getByRole('checkbox', { name: /design file includes colours/i }));

    await vi.waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([url, init]) =>
          url === `/api/admin/purchase-orders/${PO_ID}/checklist` && init?.method === 'POST',
      );
      expect(post).toBeTruthy();
      expect(JSON.parse(post![1]!.body as string)).toEqual({ itemId: 'chk-1', checked: true });
    });
    expect(await screen.findByText('staff@example.com — 6 Aug 2026')).toBeInTheDocument();
  });

  it('hints at outstanding checklist items on the enabled Send button', async () => {
    const user = userEvent.setup();
    installMockFetch(
      baseRoutes(detail(), noVarianceSummary(), { checklist: [checklistItem()] }),
    );
    renderView();
    await screen.findByText('PO-2607-VA01-JANECOACH');

    const send = screen.getByRole('button', { name: /send to supplier/i });
    // Still enabled — the server is the enforcement; the modal shows blockers.
    expect(send).toBeEnabled();
    await user.hover(send);

    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Pre-send checklist incomplete: Design file includes colours',
    );
  });

  it('a sidestepped check does not count as outstanding on the Send button', async () => {
    const user = userEvent.setup();
    installMockFetch(
      baseRoutes(detail(), noVarianceSummary(), {
        // Satisfied by an acknowledgement rather than a tick — the server
        // treats it as satisfied, so nothing is left blocking the send.
        checklist: [
          checklistItem({
            satisfied: true,
            allowSidestep: true,
            sidestepped: true,
            sidestepReason: 'no fonts on this job',
            checkedByEmail: 'ana@example.com',
            checkedAt: '2026-08-06T10:00:00Z',
          }),
        ],
      }),
    );
    renderView();
    await screen.findByText('PO-2607-VA01-JANECOACH');

    expect(await screen.findByText('Sidestepped')).toBeInTheDocument();
    await user.hover(screen.getByRole('button', { name: /send to supplier/i }));

    // No tooltip at all — the hint only exists while something is outstanding
    // (antd's own mouse-enter delay is 100ms, so wait past it).
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('blocks sending a draft and says to move it to Review first', async () => {
    const user = userEvent.setup();
    installMockFetch(baseRoutes(detail({ status: 'draft' })));
    renderView();
    await screen.findByText('PO-2607-VA01-JANECOACH');

    await user.hover(screen.getByRole('button', { name: /send to supplier/i }));

    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Move the purchase order to Review before sending it',
    );
  });

  it('shows the variance banner with counts and the expandable diff', async () => {
    const user = userEvent.setup();
    installMockFetch(baseRoutes(detail(), varianceSummary()));
    renderView();

    expect(
      await screen.findByText(
        'Order has changed since revision 1 — 1 added / 1 modified / 0 removed',
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByText('View differences'));
    expect(await screen.findByText('Added')).toBeInTheDocument();
    expect(screen.getByText(/XL · Zoe/)).toBeInTheDocument();
    expect(screen.getByText(/size: M → S/)).toBeInTheDocument();
  });

  it('does not show the variance banner when the live order matches the snapshot', async () => {
    installMockFetch(baseRoutes());
    renderView();
    await screen.findByText('PO-2607-VA01-JANECOACH');

    expect(screen.queryByText(/order has changed since revision/i)).not.toBeInTheDocument();
  });

  it('issues a revision with a required reason from the banner modal', async () => {
    const user = userEvent.setup();
    const { fetchMock, addRoute } = installMockFetch(baseRoutes(detail(), varianceSummary()));
    addRoute({
      match: `/api/admin/purchase-orders/${PO_ID}/revisions`,
      method: 'POST',
      response: { id: 'rev-2', revisionNumber: 2, reason: 'sizes corrected' },
    });
    renderView();
    await screen.findByText(/order has changed since revision 1/i);

    await user.click(screen.getByRole('button', { name: /issue revision/i }));
    const dialog = await screen.findByRole('dialog');

    // Empty reason is rejected client-side.
    await user.click(within(dialog).getByRole('button', { name: /issue revision/i }));
    expect(fetchMock).not.toHaveBeenCalledWith(
      `/api/admin/purchase-orders/${PO_ID}/revisions`,
      expect.anything(),
    );

    await user.type(within(dialog).getByRole('textbox'), 'sizes corrected');
    await user.click(within(dialog).getByRole('button', { name: /issue revision/i }));

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/admin/purchase-orders/${PO_ID}/revisions`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ reason: 'sizes corrected' }),
        }),
      );
    });
  });

  it('renders the latest-revision lines with per-garment size strips and the grand total', async () => {
    installMockFetch(baseRoutes());
    renderView();

    expect(await screen.findByText('Team Hoodie')).toBeInTheDocument();
    expect(screen.getByText('Hoodie')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('M ×2 · L ×1 — 3 pieces')).toBeInTheDocument();
    expect(screen.getByText('3 pieces total')).toBeInTheDocument();
  });

  it('renders the revision history timeline with per-revision PDF links', async () => {
    installMockFetch(
      baseRoutes(
        detail({
          currentRevisionNumber: 2,
          revisions: [
            {
              id: 'rev-2',
              revisionNumber: 2,
              reason: 'sizes corrected',
              snapshot: snapshot(),
              createdAt: '2026-07-22T10:00:00Z',
            },
            {
              id: 'rev-1',
              revisionNumber: 1,
              reason: null,
              snapshot: snapshot(),
              createdAt: '2026-07-18T10:00:00Z',
            },
          ],
        }),
      ),
    );
    renderView();

    expect(await screen.findByText('Revision 2')).toBeInTheDocument();
    expect(screen.getByText(/sizes corrected/)).toBeInTheDocument();
    expect(screen.getByText(/— Original —/)).toBeInTheDocument();
    expect(screen.getByLabelText('PDF for revision 2')).toHaveAttribute(
      'href',
      `/api/admin/purchase-orders/${PO_ID}/pdf?rev=2`,
    );
    expect(screen.getByLabelText('PDF for revision 1')).toHaveAttribute(
      'href',
      `/api/admin/purchase-orders/${PO_ID}/pdf?rev=1`,
    );
  });

  it('renders the shipments placeholder when no shipments are attached', async () => {
    installMockFetch(baseRoutes());
    renderView();
    await screen.findByText('PO-2607-VA01-JANECOACH');

    expect(screen.getByText(/shipment management arrives with the shipments page/i)).toBeInTheDocument();
  });

  it('lists attached shipments with their status badge', async () => {
    installMockFetch(
      baseRoutes(
        detail({
          shipments: [
            { id: 'ship-1', nickname: 'July air batch', carrier: 'DHL', trackingNumber: null, status: 'in_transit' },
          ],
        }),
      ),
    );
    renderView();

    expect(await screen.findByText('July air batch')).toBeInTheDocument();
    expect(screen.getByText('DHL')).toBeInTheDocument();
    expect(screen.getByText('In transit')).toBeInTheDocument();
  });

  it('shows the customer deadline as an editable picker seeded from the PO', async () => {
    installMockFetch(baseRoutes());
    renderView();
    await screen.findByText('PO-2607-VA01-JANECOACH');

    expect(screen.getByText('Customer deadline')).toBeInTheDocument();
    // Editable again (David, 2026-08-06) — a DatePicker, not display text.
    const picker = screen.getByPlaceholderText('None set') as HTMLInputElement;
    expect(picker.value).toMatch(/15 Sept? 2026/);
  });

  it('Save dates appears only once a date changed, and PATCHes the full summary', async () => {
    const user = userEvent.setup();
    const { fetchMock, addRoute } = installMockFetch(baseRoutes());
    addRoute({ match: `/api/admin/purchase-orders/${PO_ID}`, method: 'PATCH', response: detail() });
    renderView();
    await screen.findByText('PO-2607-VA01-JANECOACH');

    // Nothing changed yet — no save buttons anywhere (David, 2026-08-06).
    expect(screen.queryByRole('button', { name: 'Save dates' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save notes' })).not.toBeInTheDocument();

    const picker = screen.getByLabelText('Actual ship date');
    await user.click(picker);
    await user.type(picker, '20 Aug 2026');
    await user.keyboard('{Enter}');

    await user.click(await screen.findByRole('button', { name: 'Save dates' }));

    await vi.waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(patch?.[0]).toBe(`/api/admin/purchase-orders/${PO_ID}`);
      expect(JSON.parse(patch![1]!.body as string)).toEqual({
        deadlineDate: '2026-09-15',
        expectedShipDate: null,
        actualShipDate: '2026-08-20',
        notes: null,
      });
    });
  });

  it('Save notes appears only once the notes differ from the loaded value', async () => {
    const user = userEvent.setup();
    const { fetchMock, addRoute } = installMockFetch(baseRoutes());
    addRoute({ match: `/api/admin/purchase-orders/${PO_ID}`, method: 'PATCH', response: detail() });
    renderView();
    await screen.findByText('PO-2607-VA01-JANECOACH');

    expect(screen.queryByRole('button', { name: 'Save notes' })).not.toBeInTheDocument();

    await user.type(
      screen.getByPlaceholderText('Anything the supplier needs to know'),
      'Ship in two boxes',
    );

    await user.click(await screen.findByRole('button', { name: 'Save notes' }));

    await vi.waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(patch?.[0]).toBe(`/api/admin/purchase-orders/${PO_ID}`);
      expect(JSON.parse(patch![1]!.body as string)).toMatchObject({
        notes: 'Ship in two boxes',
      });
    });
  });

  it('leads with the display title and keeps the canonical poNumber beneath when they differ', async () => {
    installMockFetch(
      baseRoutes(
        detail({ poNumber: 'VA1', customerRef: 'Jane Coach', sentAt: '2026-07-20T10:00:00Z' }),
      ),
    );
    renderView();

    // YYMM of the send date + poNumber + normalised ref.
    expect(await screen.findByText('2607-VA1-JANE-COACH')).toBeInTheDocument();
    // The canonical number stays visible (it is what URLs/emails reference).
    expect(screen.getByText('VA1')).toBeInTheDocument();
  });

  it('edits the customer ref from the header and PATCHes customerRef', async () => {
    const user = userEvent.setup();
    const { fetchMock, addRoute } = installMockFetch(baseRoutes());
    addRoute({
      match: `/api/admin/purchase-orders/${PO_ID}`,
      method: 'PATCH',
      response: { ok: true },
    });
    renderView();
    await screen.findByText('PO-2607-VA01-JANECOACH');

    await user.click(screen.getByRole('button', { name: 'Edit customer ref' }));
    await user.type(await screen.findByLabelText('Customer ref'), 'Jane Coach');
    await user.click(screen.getByRole('button', { name: 'Save ref' }));

    await vi.waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(patch?.[0]).toBe(`/api/admin/purchase-orders/${PO_ID}`);
      expect(JSON.parse(patch![1]!.body as string)).toEqual({ customerRef: 'Jane Coach' });
    });
    expect(await screen.findByText('Customer ref saved')).toBeInTheDocument();
  });

  it('shows Move to review for a draft PO and blocks sending until it is in review', async () => {
    installMockFetch(baseRoutes(detail({ status: 'draft' })));
    renderView();
    await screen.findByText('PO-2607-VA01-JANECOACH');

    expect(screen.getByRole('button', { name: /move to review/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send to supplier/i })).toBeDisabled();
  });

  it('Move to review posts the approved status (the value behind the Review label)', async () => {
    const user = userEvent.setup();
    const { fetchMock, addRoute } = installMockFetch(baseRoutes(detail({ status: 'draft' })));
    addRoute({
      match: `/api/admin/purchase-orders/${PO_ID}/status`,
      method: 'POST',
      response: { ok: true },
    });
    renderView();
    await screen.findByText('PO-2607-VA01-JANECOACH');

    await user.click(screen.getByRole('button', { name: /move to review/i }));

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/admin/purchase-orders/${PO_ID}/status`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ status: 'approved' }),
        }),
      );
    });
  });

  it('always shows the portal URL with Open and the copy link + password snippet', async () => {
    installMockFetch(baseRoutes());
    renderView();

    expect(
      await screen.findByText('https://orders.example.com/supplier/VA/PO-2607-VA01-JANECOACH'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open/i })).toHaveAttribute(
      'href',
      'https://orders.example.com/supplier/VA/PO-2607-VA01-JANECOACH',
    );
    expect(
      await screen.findByRole('button', { name: /copy link \+ password/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Portal password: hunter22/)).toBeInTheDocument();
    // The password itself renders big and copyable (David, 2026-08-06).
    expect(screen.getByTestId('portal-password')).toHaveTextContent('hunter22');
    // The token generate/revoke flow is gone.
    expect(screen.queryByRole('button', { name: /generate link/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /revoke link/i })).not.toBeInTheDocument();
  });

  it('warns that the portal is closed when the supplier has no password', async () => {
    installMockFetch(baseRoutes(detail(), noVarianceSummary(), { portalPassword: null }));
    renderView();

    expect(await screen.findByText('The supplier portal is closed')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /copy link \+ password/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /supplier record/i })).toHaveAttribute(
      'href',
      '/admin/suppliers',
    );
  });

  it('shows when the legacy emailed link was last opened', async () => {
    installMockFetch(
      baseRoutes(detail({ supplierLink: { active: true, lastViewedAt: '2026-07-25T10:00:00Z' } })),
    );
    renderView();

    expect(await screen.findByText(/legacy emailed link last opened/i)).toBeInTheDocument();
  });

  it('renders the history card with plain labels, actors and from→to', async () => {
    installMockFetch(
      baseRoutes(
        detail({
          history: [
            {
              id: 'h2',
              eventType: 'po.status_changed',
              actorEmail: 'sam@example.com',
              payload: { poId: PO_ID, from: 'approved', to: 'sent' },
              createdAt: '2026-07-20T10:00:00Z',
            },
            {
              id: 'h1',
              eventType: 'po.created',
              actorEmail: 'sam@example.com',
              payload: { poId: PO_ID },
              createdAt: '2026-07-18T10:00:00Z',
            },
          ],
        }),
      ),
    );
    renderView();

    expect(await screen.findByText('Status changed')).toBeInTheDocument();
    // Statuses render their display labels, not the raw keys.
    expect(screen.getByText('Review → Unconfirmed')).toBeInTheDocument();
    expect(screen.getByText('Created')).toBeInTheDocument();
    expect(screen.getAllByText('sam@example.com')).toHaveLength(2);
  });

  it('shows only SHARED comments in the supplier conversation', async () => {
    installMockFetch(
      baseRoutes(detail(), noVarianceSummary(), {
        comments: [
          note(),
          note({ id: 'note-2', body: 'internal grumbling', visibility: 'internal' }),
          note({
            id: 'note-3',
            body: 'We will ship Friday',
            authorKind: 'supplier',
            authorName: null,
            authorEmail: null,
            authorLabel: 'Factory rep',
          }),
        ],
      }),
    );
    renderView();

    expect(await screen.findByText('Please double-box the hoodies')).toBeInTheDocument();
    expect(screen.getByText('We will ship Friday')).toBeInTheDocument();
    expect(screen.getByText('Factory rep')).toBeInTheDocument();
    expect(screen.queryByText('internal grumbling')).not.toBeInTheDocument();
  });

  it('posts a staff reply as a shared rich-text comment', async () => {
    const user = userEvent.setup();
    const { fetchMock, addRoute } = installMockFetch(baseRoutes());
    addRoute({
      match: '/api/admin/orders/order-1/notes',
      method: 'POST',
      status: 201,
      response: { id: 'note-9' },
    });
    renderView();
    await screen.findByText('PO-2607-VA01-JANECOACH');

    await writeInEditor('New supplier comment', '<p>Thanks, <strong>confirmed</strong></p>');
    await user.click(screen.getByRole('button', { name: /post to supplier/i }));

    await vi.waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(post?.[0]).toBe('/api/admin/orders/order-1/notes');
      // HTML body, explicit comment kind, shared with the supplier.
      expect(JSON.parse(post![1]!.body as string)).toEqual({
        body: '<p>Thanks, <strong>confirmed</strong></p>',
        kind: 'comment',
        visibility: 'shared',
      });
    });
  });

  it('brings the team order notes through under the "Internal order notes" title', async () => {
    installMockFetch(
      baseRoutes(detail(), noVarianceSummary(), {
        orderNotes: [note({ id: 'n1', body: 'Sleeves 1cm shorter', visibility: 'internal' })],
      }),
    );
    renderView();

    expect(await screen.findByText('Internal order notes')).toBeInTheDocument();
    expect(screen.queryByText('Order notes (from the order)')).not.toBeInTheDocument();
    expect(await screen.findByText('Sleeves 1cm shorter')).toBeInTheDocument();
  });

  it('adds an internal order note from the rail composer as kind "note"', async () => {
    const user = userEvent.setup();
    const { fetchMock, addRoute } = installMockFetch(baseRoutes());
    addRoute({
      match: '/api/admin/orders/order-1/notes',
      method: 'POST',
      status: 201,
      response: { id: 'note-10' },
    });
    renderView();
    await screen.findByText('PO-2607-VA01-JANECOACH');

    await user.type(screen.getByLabelText('New order note'), 'Sleeves 1cm shorter');
    await user.click(screen.getByRole('button', { name: /add note/i }));

    await vi.waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(post?.[0]).toBe('/api/admin/orders/order-1/notes');
      // Plain text, kind 'note', internal by default (no visibility sent).
      expect(JSON.parse(post![1]!.body as string)).toEqual({
        body: 'Sleeves 1cm shorter',
        kind: 'note',
      });
    });
  });

  it('renders labelled garment sections with chart links, image thumbnails and custom sizing columns', async () => {
    const snap = snapshot();
    snap.garments[0] = {
      ...snap.garments[0],
      fabrics: ['Dri-fit'],
      selectedFabrics: { Body: 'Dri-fit' },
      selectedOptions: { Collar: 'V-neck' },
      sizingColumns: [{ label: 'Initials', type: 'text' }],
      // The admin GET serves the LATEST revision signed (signPoSnapshotMedia):
      // charts carry downloadUrl, images carry url/thumbnailUrl.
      sizeCharts: [
        {
          id: 'sc1',
          name: 'Adult hoodie chart',
          storageKey: 'charts/x.png',
          downloadUrl: 'https://signed.example.com/charts/x.png',
        },
      ],
      images: [
        {
          id: 'img1',
          storageKey: 'mockups/a.png',
          thumbnailStorageKey: 'mockups/a-thumb.png',
          caption: 'Front',
          url: 'https://signed.example.com/mockups/a.png',
          thumbnailUrl: 'https://signed.example.com/mockups/a-thumb.png',
        },
        {
          id: 'img2',
          storageKey: 'mockups/b.png',
          thumbnailStorageKey: null,
          caption: null,
          url: 'https://signed.example.com/mockups/b.png',
          thumbnailUrl: null,
        },
      ],
      lines: [
        {
          sizingRowId: 'row-1',
          size: 'M',
          playerName: 'Alice',
          playerNumber: '7',
          notes: null,
          customValues: { Initials: 'AB' },
          quantity: 2,
        },
      ],
    } as unknown as (typeof snap.garments)[0];
    installMockFetch(
      baseRoutes(
        detail({
          revisions: [
            {
              id: 'rev-1',
              revisionNumber: 1,
              reason: null,
              snapshot: snap,
              createdAt: '2026-07-18T10:00:00Z',
            },
          ],
        }),
      ),
    );
    renderView();

    // The section labels pop out as headings (David, 2026-08-06).
    expect(await screen.findByText('Fabrics')).toBeInTheDocument();
    expect(screen.getByText('Options')).toBeInTheDocument();
    expect(screen.getByText('Size charts')).toBeInTheDocument();
    expect(screen.getByText('Images')).toBeInTheDocument();
    expect(screen.getByText('Sizing')).toBeInTheDocument();

    expect(screen.getByText('Body: Dri-fit')).toBeInTheDocument();
    expect(screen.getByText('Collar: V-neck')).toBeInTheDocument();

    // Chart names link to the signed download.
    expect(screen.getByText('Adult hoodie chart').closest('a')).toHaveAttribute(
      'href',
      'https://signed.example.com/charts/x.png',
    );

    // Mock-up images render as clickable thumbnails opening the full image.
    const front = screen.getByAltText('Front') as HTMLImageElement;
    expect(front.src).toBe('https://signed.example.com/mockups/a-thumb.png');
    expect(front.closest('a')).toHaveAttribute(
      'href',
      'https://signed.example.com/mockups/a.png',
    );
    // No thumbnail → the full image stands in.
    const second = screen.getByAltText('Garment mock-up') as HTMLImageElement;
    expect(second.src).toBe('https://signed.example.com/mockups/b.png');

    // The snapshot's custom sizing column drives a real table column.
    expect(screen.getByText('Initials')).toBeInTheDocument();
    expect(screen.getByText('AB')).toBeInTheDocument();
    expect(screen.getByText('Qty')).toBeInTheDocument();
  });

  it('shows "Colour book: None" with an Edit affordance when no book is set', async () => {
    installMockFetch(baseRoutes());
    renderView();
    await screen.findByText('PO-2607-VA01-JANECOACH');

    expect(screen.getByText('Colour book:')).toBeInTheDocument();
    expect(screen.getByText('None')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit colour book' })).toBeInTheDocument();
  });

  it('shows the PO colour book name in the summary', async () => {
    installMockFetch(
      baseRoutes(detail({ colorBookId: 'cb-old', colorBookName: 'Pantone 2024' })),
    );
    renderView();

    expect(await screen.findByText('Pantone 2024')).toBeInTheDocument();
    expect(screen.queryByText('None')).not.toBeInTheDocument();
  });

  it('edits the colour book from the supplier book list and PATCHes colorBookId', async () => {
    const user = userEvent.setup();
    const { fetchMock, addRoute } = installMockFetch(
      baseRoutes(detail({ colorBookId: 'cb-old', colorBookName: 'Pantone 2024' })),
    );
    addRoute({
      match: '/api/admin/suppliers/sup-1/color-books',
      method: 'GET',
      response: {
        items: [
          { id: 'cb-new', name: 'Pantone 2026', createdAt: '2026-08-01T00:00:00Z' },
          { id: 'cb-old', name: 'Pantone 2024', createdAt: '2024-08-01T00:00:00Z' },
        ],
      },
    });
    addRoute({
      match: `/api/admin/purchase-orders/${PO_ID}`,
      method: 'PATCH',
      response: { ok: true },
    });
    renderView();
    await screen.findByText('PO-2607-VA01-JANECOACH');

    await user.click(screen.getByRole('button', { name: 'Edit colour book' }));
    await user.click(await screen.findByRole('combobox', { name: 'Colour book' }));
    // Newest first — the first option is flagged as the latest/default.
    await user.click(await screen.findByText('Pantone 2026 (latest)'));

    await vi.waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(patch?.[0]).toBe(`/api/admin/purchase-orders/${PO_ID}`);
      expect(JSON.parse(patch![1]!.body as string)).toEqual({ colorBookId: 'cb-new' });
    });
    expect(await screen.findByText('Colour book updated')).toBeInTheDocument();
  });

  it('renders the production files card with its files', async () => {
    const { addRoute } = installMockFetch(baseRoutes());
    // Registered after baseRoutes' empty files route, so it wins.
    addRoute({
      match: `/api/admin/purchase-orders/${PO_ID}/files`,
      method: 'GET',
      response: {
        items: [
          {
            id: 'file-1',
            fileName: 'layout-v1.pdf',
            contentType: 'application/pdf',
            sizeBytes: 1000,
            category: 'Test print',
            uploadedByKind: 'staff',
            uploadedByLabel: 'dana@example.com',
            statusAtUpload: 'test_print',
            createdAt: '2026-07-19T10:00:00Z',
            downloadUrl: 'https://signed.example.com/layout-v1.pdf',
            comments: [],
          },
        ],
      },
    });
    renderView();

    expect(await screen.findByText('Production files')).toBeInTheDocument();
    // The file shows in BOTH lenses: the structured card and the Comments feed.
    expect(await screen.findAllByText('layout-v1.pdf')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /download all as zip/i }).closest('a')).toHaveAttribute(
      'href',
      `/api/admin/purchase-orders/${PO_ID}/files.zip`,
    );
  });

  it('hides the Revision history card while the PO is unsent', async () => {
    installMockFetch(baseRoutes(detail({ status: 'draft' })));
    renderView();
    await screen.findByText('PO-2607-VA01-JANECOACH');

    // No revision noise before sending (David, 2026-08-06).
    expect(screen.queryByText('Revision history')).not.toBeInTheDocument();
  });

  it('shows the Revision history card from sent onward', async () => {
    installMockFetch(baseRoutes()); // default status: 'sent'
    renderView();
    await screen.findByText('PO-2607-VA01-JANECOACH');

    expect(screen.getByText('Revision history')).toBeInTheDocument();
  });

  it('offers Refresh from order on an unsent PO and posts the refresh', async () => {
    const user = userEvent.setup();
    const { fetchMock, addRoute } = installMockFetch(baseRoutes(detail({ status: 'draft' })));
    addRoute({
      match: `/api/admin/purchase-orders/${PO_ID}/refresh`,
      method: 'POST',
      response: { ok: true },
    });
    renderView();
    await screen.findByText('PO-2607-VA01-JANECOACH');

    await user.click(screen.getByRole('button', { name: /refresh from order/i }));

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/admin/purchase-orders/${PO_ID}/refresh`,
        expect.objectContaining({ method: 'POST' }),
      );
    });
    expect(
      await screen.findByText('Purchase order refreshed from the live order'),
    ).toBeInTheDocument();
  });

  it('hides Refresh from order once the PO has been sent', async () => {
    installMockFetch(baseRoutes()); // default status: 'sent'
    renderView();
    await screen.findByText('PO-2607-VA01-JANECOACH');

    expect(screen.queryByRole('button', { name: /refresh from order/i })).not.toBeInTheDocument();
  });

  it('uploads a garment image internal-only and refreshes an unsent PO', async () => {
    const user = userEvent.setup();
    const { fetchMock, addRoute } = installMockFetch(baseRoutes(detail({ status: 'draft' })));
    addRoute({
      match: '/api/admin/orders/order-1/garments/g1/images',
      method: 'POST',
      status: 201,
      response: { id: 'img-9' },
    });
    addRoute({
      match: `/api/admin/purchase-orders/${PO_ID}/refresh`,
      method: 'POST',
      response: { ok: true },
    });
    renderView();
    await screen.findByText('Team Hoodie');

    await user.type(screen.getByLabelText('Image caption for Team Hoodie'), 'Chest logo close-up');
    const addButton = screen.getByRole('button', { name: 'Add image to Team Hoodie' });
    const input = addButton
      .closest('.ant-upload')!
      .querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(['img-bytes'], 'logo.png', { type: 'image/png' }));

    await vi.waitFor(() => {
      const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
      const imagePost = posts.find(([url]) => url === '/api/admin/orders/order-1/garments/g1/images');
      expect(imagePost).toBeTruthy();
      const form = imagePost![1]!.body as FormData;
      expect(form).toBeInstanceOf(FormData);
      expect((form.get('file') as File).name).toBe('logo.png');
      expect(form.get('caption')).toBe('Chest logo close-up');
      // Team-only: hidden from the customer, still rides the PO snapshot.
      expect(form.get('internalOnly')).toBe('true');
      // The draft re-cuts its snapshot so the image appears on the PO.
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/admin/purchase-orders/${PO_ID}/refresh`,
        expect.objectContaining({ method: 'POST' }),
      );
    });
    expect(
      await screen.findByText('Image added — purchase order refreshed from the order'),
    ).toBeInTheDocument();
  });

  it('tells the user a revision is needed when the image refresh 409s on a sent PO', async () => {
    const user = userEvent.setup();
    const { addRoute } = installMockFetch(baseRoutes()); // default status: 'sent'
    addRoute({
      match: '/api/admin/orders/order-1/garments/g1/images',
      method: 'POST',
      status: 201,
      response: { id: 'img-9' },
    });
    addRoute({
      match: `/api/admin/purchase-orders/${PO_ID}/refresh`,
      method: 'POST',
      status: 409,
      response: { error: 'A sent purchase order changes through revisions, not refreshes' },
    });
    renderView();
    await screen.findByText('Team Hoodie');

    const addButton = screen.getByRole('button', { name: 'Add image to Team Hoodie' });
    const input = addButton
      .closest('.ant-upload')!
      .querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(['img-bytes'], 'logo.png', { type: 'image/png' }));

    expect(
      await screen.findByText(/already been sent — issue a revision to include it/i),
    ).toBeInTheDocument();
  });

  it('merges file uploads into the Comments feed with inline image thumbnails and rich comment bodies', async () => {
    const { addRoute } = installMockFetch(
      baseRoutes(detail(), noVarianceSummary(), {
        comments: [
          note({
            id: 'note-html',
            body: 'Use the navy thread',
            bodyHtml: '<p>Use the <strong>navy</strong> thread</p>',
            createdAt: '2026-07-21T10:00:00Z',
          }),
        ],
      }),
    );
    addRoute({
      match: `/api/admin/purchase-orders/${PO_ID}/files`,
      method: 'GET',
      response: {
        items: [
          {
            id: 'file-img',
            fileName: 'test-print.jpg',
            contentType: 'image/jpeg',
            sizeBytes: 2048,
            category: 'Test print',
            uploadedByKind: 'supplier',
            uploadedByLabel: 'Vast Apparel',
            statusAtUpload: 'test_print',
            createdAt: '2026-07-22T10:00:00Z',
            downloadUrl: 'https://signed.example.com/test-print.jpg',
            comments: [],
          },
        ],
      },
    });
    renderView();

    // The file entry renders inline as a thumbnail in the comments stream.
    const thumb = (await screen.findByAltText('test-print.jpg')) as HTMLImageElement;
    expect(thumb.src).toBe('https://signed.example.com/test-print.jpg');
    // Rich comment bodies render as real formatting, sanitised client-side.
    expect(screen.getByText('navy').tagName).toBe('STRONG');
  });

  it('attaches a file from the Comments card with the default Reference image category', async () => {
    const user = userEvent.setup();
    const { fetchMock, addRoute } = installMockFetch(baseRoutes());
    addRoute({
      match: `/api/admin/purchase-orders/${PO_ID}/files`,
      method: 'POST',
      status: 201,
      response: { id: 'file-9' },
    });
    renderView();
    await screen.findByText('PO-2607-VA01-JANECOACH');

    // The category control defaults to the reference-image suggestion.
    expect(screen.getByRole('combobox', { name: 'Attachment category' })).toHaveValue(
      'Reference image',
    );

    const attachButton = screen.getByRole('button', { name: /attach file/i });
    const input = attachButton
      .closest('.ant-upload')!
      .querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(['ref-bytes'], 'ref.png', { type: 'image/png' }));

    await vi.waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([url, init]) =>
          url === `/api/admin/purchase-orders/${PO_ID}/files` && init?.method === 'POST',
      );
      expect(post).toBeTruthy();
      const form = post![1]!.body as FormData;
      expect((form.get('file') as File).name).toBe('ref.png');
      expect(form.get('category')).toBe('Reference image');
    });
    expect(await screen.findByText('ref.png attached')).toBeInTheDocument();
  });
});
