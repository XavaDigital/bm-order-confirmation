import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { installMockFetch } from '@/test/mockFetch';
import { SendPoModal } from './SendPoModal';

const PO_ID = 'po-1';

function preview(overrides: Record<string, unknown> = {}) {
  return {
    to: 'factory@example.com',
    toName: 'Li Wei',
    subject: 'Purchase order VA1 — BeastMode',
    html: '<!DOCTYPE html><html><body><p>Hi Li Wei,</p></body></html>',
    portalUrl: 'https://orders.example.com/supplier/VA/po/VA1',
    attachments: [
      { filename: 'VA1.pdf' },
      { filename: 'VA1.xlsx' },
      { filename: 'TeamFont.ttf' },
      { filename: 'size-chart-Hoodie chart.png' },
    ],
    ...overrides,
  };
}

function renderModal(props: Partial<Parameters<typeof SendPoModal>[0]> = {}) {
  const onClose = vi.fn();
  const onSent = vi.fn();
  render(
    <SendPoModal
      open
      poId={PO_ID}
      revisionNumber={1}
      onClose={onClose}
      onSent={onSent}
      {...props}
    />,
  );
  return { onClose, onSent };
}

beforeEach(() => {
  installMockFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SendPoModal', () => {
  it('fetches the preview on open and shows To, subject, attachments and the rendered email', async () => {
    installMockFetch([
      {
        match: `/api/admin/purchase-orders/${PO_ID}/send-preview`,
        method: 'GET',
        response: preview(),
      },
    ]);
    renderModal();

    expect(await screen.findByText(/Li Wei <factory@example.com>/)).toBeInTheDocument();
    expect(screen.getByText('Purchase order VA1 — BeastMode')).toBeInTheDocument();
    // Every attachment listed by name — PDF, XLSX and the snapshot files.
    for (const name of ['VA1.pdf', 'VA1.xlsx', 'TeamFont.ttf', 'size-chart-Hoodie chart.png']) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    // The email body renders in a sandboxed iframe from the composed html.
    const frame = screen.getByTitle('Email preview') as HTMLIFrameElement;
    expect(frame.getAttribute('srcdoc')).toContain('Hi Li Wei,');
  });

  it('sends with the typed message intro and reports the result', async () => {
    const user = userEvent.setup();
    const { fetchMock, addRoute } = installMockFetch([
      {
        match: `/api/admin/purchase-orders/${PO_ID}/send-preview`,
        method: 'GET',
        response: preview(),
      },
    ]);
    const result = {
      ok: true,
      poNumber: 'VA1',
      to: 'factory@example.com',
      attachmentSummary: { images: 0, fonts: 1, sizeCharts: 1, sizeReduced: false },
    };
    addRoute({
      match: `/api/admin/purchase-orders/${PO_ID}/send`,
      method: 'POST',
      response: result,
    });
    const { onClose, onSent } = renderModal();

    await user.type(
      await screen.findByLabelText('Message to the supplier'),
      'Rush job — ship by Friday',
    );
    await user.click(screen.getByRole('button', { name: /send email/i }));

    await vi.waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(post?.[0]).toBe(`/api/admin/purchase-orders/${PO_ID}/send`);
      expect(JSON.parse(post![1]!.body as string)).toEqual({
        messageIntro: 'Rush job — ship by Friday',
      });
    });
    expect(onSent).toHaveBeenCalledWith(result);
    expect(onClose).toHaveBeenCalled();
  });

  it('sends an empty body when no message intro was typed', async () => {
    const user = userEvent.setup();
    const { fetchMock, addRoute } = installMockFetch([
      {
        match: `/api/admin/purchase-orders/${PO_ID}/send-preview`,
        method: 'GET',
        response: preview(),
      },
    ]);
    addRoute({
      match: `/api/admin/purchase-orders/${PO_ID}/send`,
      method: 'POST',
      response: {
        ok: true,
        poNumber: 'VA1',
        to: 'factory@example.com',
        attachmentSummary: { images: 0, fonts: 0, sizeCharts: 0, sizeReduced: false },
      },
    });
    renderModal();
    await screen.findByText(/Li Wei <factory@example.com>/);

    await user.click(screen.getByRole('button', { name: /send email/i }));

    await vi.waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(JSON.parse(post![1]!.body as string)).toEqual({});
    });
  });

  it('surfaces checklist/gate blockers from a 409 and keeps the modal open', async () => {
    const user = userEvent.setup();
    const { addRoute } = installMockFetch([
      {
        match: `/api/admin/purchase-orders/${PO_ID}/send-preview`,
        method: 'GET',
        response: preview(),
      },
    ]);
    addRoute({
      match: `/api/admin/purchase-orders/${PO_ID}/send`,
      method: 'POST',
      status: 409,
      response: {
        error: 'Blocked by outstanding checks: Artwork approved',
        details: {
          gateKey: 'po_send',
          outstanding: [{ slug: 'artwork_approved', name: 'Artwork approved' }],
        },
      },
    });
    const { onClose, onSent } = renderModal();
    await screen.findByText(/Li Wei <factory@example.com>/);

    await user.click(screen.getByRole('button', { name: /send email/i }));

    expect(
      await screen.findByText('Blocked by outstanding checks: Artwork approved'),
    ).toBeInTheDocument();
    // The gate's outstanding tasks render as a list the user can act on.
    expect(screen.getByRole('listitem')).toHaveTextContent('Artwork approved');
    expect(onSent).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('surfaces a plain 409 (pre-send checklist) message without a list', async () => {
    const user = userEvent.setup();
    const { addRoute } = installMockFetch([
      {
        match: `/api/admin/purchase-orders/${PO_ID}/send-preview`,
        method: 'GET',
        response: preview(),
      },
    ]);
    addRoute({
      match: `/api/admin/purchase-orders/${PO_ID}/send`,
      method: 'POST',
      status: 409,
      response: { error: 'Pre-send checklist incomplete: Design file includes colours' },
    });
    renderModal();
    await screen.findByText(/Li Wei <factory@example.com>/);

    await user.click(screen.getByRole('button', { name: /send email/i }));

    expect(
      await screen.findByText('Pre-send checklist incomplete: Design file includes colours'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('shows the preview 409 message and disables Send when the preview itself refuses', async () => {
    installMockFetch([
      {
        match: `/api/admin/purchase-orders/${PO_ID}/send-preview`,
        method: 'GET',
        status: 409,
        response: { error: 'Move the purchase order to Review before sending it' },
      },
    ]);
    renderModal();

    expect(
      await screen.findByText('Move the purchase order to Review before sending it'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send email/i })).toBeDisabled();
  });
});
