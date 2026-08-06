import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import { installMockFetch, type MockRoute } from '@/test/mockFetch';
import { PO_FILE_CATEGORIES } from '@/server/purchase-orders/files-contract';
import { PoFilesCard, usePoFiles, type PoFileItem } from './PoFilesCard';

const PO_ID = 'po-1';
const FILES_URL = `/api/admin/purchase-orders/${PO_ID}/files`;

function file(overrides: Partial<PoFileItem> = {}): PoFileItem {
  return {
    id: 'file-1',
    fileName: 'layout.pdf',
    contentType: 'application/pdf',
    sizeBytes: 1234,
    category: 'Layout',
    uploadedByKind: 'staff',
    uploadedByLabel: 'dana@example.com',
    statusAtUpload: 'design_prep',
    createdAt: '2026-07-19T10:00:00Z',
    downloadUrl: 'https://signed.example.com/layout.pdf',
    comments: [],
    ...overrides,
  };
}

function filesRoute(items: PoFileItem[]): MockRoute {
  return { match: FILES_URL, method: 'GET', response: { items } };
}

/**
 * The page owns the files data since 2026-08-06 (shared with the Comments rail
 * feed) — this harness stands in for the page, wiring usePoFiles to the card
 * exactly as PoDetailView does.
 */
function Harness() {
  const { items, loadError, reload } = usePoFiles(PO_ID);
  return <PoFilesCard poId={PO_ID} items={items} loadError={loadError} onChanged={reload} />;
}

function renderCard() {
  return render(
    <AntdApp>
      <Harness />
    </AntdApp>,
  );
}

beforeEach(() => {
  installMockFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PoFilesCard', () => {
  it('shows the empty state and disables the ZIP button with no files', async () => {
    installMockFetch([filesRoute([])]);
    renderCard();

    expect(await screen.findByText('No production files yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download all as zip/i })).toBeDisabled();
  });

  it('groups files by category with per-category v1/v2 version counters, oldest first', async () => {
    installMockFetch([
      filesRoute([
        // API serves oldest first; versions count within a category.
        file({ id: 'f1', fileName: 'layout.ai', category: 'Layout', createdAt: '2026-07-10T10:00:00Z' }),
        file({ id: 'f2', fileName: 'test-print-1.jpg', category: 'Test print', createdAt: '2026-07-12T10:00:00Z', statusAtUpload: 'test_print' }),
        file({ id: 'f3', fileName: 'test-print-2.jpg', category: 'Test print', createdAt: '2026-07-15T10:00:00Z', statusAtUpload: 'test_print', uploadedByKind: 'supplier', uploadedByLabel: 'Vast Apparel' }),
      ]),
    ]);
    renderCard();

    expect(await screen.findByText('layout.ai')).toBeInTheDocument();

    // Category headings in first-upload order.
    expect(screen.getByText('Layout')).toBeInTheDocument();
    const testPrintHeading = screen.getByText('Test print', { selector: 'strong' });
    expect(testPrintHeading).toBeInTheDocument();

    // The second test print reads v2 — the progression at a glance.
    const rows = screen.getAllByText(/^v\d$/).map((el) => el.textContent);
    expect(rows).toEqual(['v1', 'v1', 'v2']);

    // Supplier-uploaded files are marked as such (label · date in one line).
    expect(screen.getByText(/Vast Apparel/)).toBeInTheDocument();
    expect(screen.getAllByText('Supplier').length).toBeGreaterThan(0);
  });

  it('shows the PO status at upload as a chip and links the signed download', async () => {
    installMockFetch([filesRoute([file({ statusAtUpload: 'in_production' })])]);
    renderCard();

    const link = (await screen.findByText('layout.pdf')).closest('a');
    expect(link).toHaveAttribute('href', 'https://signed.example.com/layout.pdf');
    // poStatusMeta drives the chip label.
    expect(screen.getByText('Production')).toBeInTheDocument();
  });

  it('posts a comment on a file thread and shows it after the reload', async () => {
    const user = userEvent.setup();
    const { fetchMock, addRoute } = installMockFetch([filesRoute([file()])]);
    addRoute({
      match: `${FILES_URL}/file-1`,
      method: 'POST',
      status: 201,
      response: {
        id: 'note-1',
        body: 'Looks good, print it',
        authorKind: 'staff',
        authorName: 'Dana Sales',
        authorEmail: 'dana@example.com',
        authorLabel: null,
        createdAt: '2026-07-20T10:00:00Z',
      },
    });
    renderCard();
    await screen.findByText('layout.pdf');

    // The card reloads the shared data after posting — serve the new comment.
    addRoute(
      filesRoute([
        file({
          comments: [
            {
              id: 'note-1',
              body: 'Looks good, print it',
              authorKind: 'staff',
              authorName: 'Dana Sales',
              authorEmail: 'dana@example.com',
              authorLabel: null,
              createdAt: '2026-07-20T10:00:00Z',
            },
          ],
        }),
      ]),
    );

    await user.type(screen.getByLabelText('Comment on layout.pdf'), 'Looks good, print it');
    await user.click(screen.getByRole('button', { name: 'Post comment on layout.pdf' }));

    await vi.waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(post?.[0]).toBe(`${FILES_URL}/file-1`);
      expect(JSON.parse(post![1]!.body as string)).toEqual({ body: 'Looks good, print it' });
    });
    expect(await screen.findByText('Looks good, print it')).toBeInTheDocument();
    expect(screen.getByText('Dana Sales')).toBeInTheDocument();
  });

  it('renders existing comments, including supplier ones', async () => {
    installMockFetch([
      filesRoute([
        file({
          comments: [
            {
              id: 'c1',
              body: 'Colour looks washed out',
              authorKind: 'supplier',
              authorName: null,
              authorEmail: null,
              authorLabel: 'Factory rep',
              createdAt: '2026-07-19T12:00:00Z',
            },
          ],
        }),
      ]),
    ]);
    renderCard();

    expect(await screen.findByText('Colour looks washed out')).toBeInTheDocument();
    expect(screen.getByText('Factory rep')).toBeInTheDocument();
  });

  it('hides a file through the Popconfirm and reloads the list', async () => {
    const user = userEvent.setup();
    const { fetchMock, addRoute } = installMockFetch([filesRoute([file()])]);
    addRoute({ match: `${FILES_URL}/file-1`, method: 'DELETE', response: { ok: true } });
    renderCard();
    await screen.findByText('layout.pdf');

    // After the delete, the reload should see an empty list.
    addRoute(filesRoute([]));

    await user.click(screen.getByRole('button', { name: 'Hide layout.pdf' }));
    const dialog = await screen.findByRole('tooltip');
    await user.click(within(dialog).getByRole('button', { name: 'Hide' }));

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `${FILES_URL}/file-1`,
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
    expect(await screen.findByText('No production files yet.')).toBeInTheDocument();
  });

  it('uploads a file with the typed category as one-shot multipart', async () => {
    const user = userEvent.setup();
    const { fetchMock, addRoute } = installMockFetch([filesRoute([])]);
    addRoute({ match: FILES_URL, method: 'POST', status: 201, response: { id: 'file-9' } });
    renderCard();
    await screen.findByText('No production files yet.');

    // After the upload the card reloads — serve the new file.
    addRoute(filesRoute([file({ id: 'file-9', fileName: 'test.png', category: 'Test print' })]));

    await user.type(screen.getByRole('combobox'), 'Test print');
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(['png-bytes'], 'test.png', { type: 'image/png' }));

    await vi.waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(post?.[0]).toBe(FILES_URL);
      const body = post![1]!.body as FormData;
      expect(body).toBeInstanceOf(FormData);
      expect((body.get('file') as File).name).toBe('test.png');
      expect(body.get('category')).toBe('Test print');
    });
    expect(await screen.findByText('test.png uploaded')).toBeInTheDocument();
    expect(await screen.findByText('test.png')).toBeInTheDocument();
  });

  it('surfaces the storage-unconfigured 503 message on upload', async () => {
    const user = userEvent.setup();
    const { addRoute } = installMockFetch([filesRoute([])]);
    addRoute({
      match: FILES_URL,
      method: 'POST',
      status: 503,
      response: { error: 'File storage is not configured on this server' },
    });
    renderCard();
    await screen.findByText('No production files yet.');

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(['x'], 'layout.ai'));

    expect(
      await screen.findByText('File storage is not configured on this server'),
    ).toBeInTheDocument();
  });

  it('suggests the SHARED category vocabulary (files-contract) on upload', async () => {
    const user = userEvent.setup();
    installMockFetch([filesRoute([])]);
    renderCard();
    await screen.findByText('No production files yet.');

    await user.click(screen.getByRole('combobox'));

    // The one list both surfaces use — including the 2026-08-06 additions.
    for (const category of PO_FILE_CATEGORIES) {
      expect(await screen.findByTitle(category)).toBeInTheDocument();
    }
  });

  it('links Download all as ZIP to the bundle route when files exist', async () => {
    installMockFetch([filesRoute([file()])]);
    renderCard();
    await screen.findByText('layout.pdf');

    const button = screen.getByRole('button', { name: /download all as zip/i });
    expect(button).toBeEnabled();
    expect(button.closest('a')).toHaveAttribute(
      'href',
      `/api/admin/purchase-orders/${PO_ID}/files.zip`,
    );
  });
});
