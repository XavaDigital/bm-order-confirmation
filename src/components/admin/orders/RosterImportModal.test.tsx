import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import { RosterImportModal } from './RosterImportModal';

function renderModal(props: Partial<React.ComponentProps<typeof RosterImportModal>> = {}) {
  const onClose = vi.fn();
  const onImported = vi.fn();
  const utils = render(
    <AntdApp>
      <RosterImportModal orderId="order-1" open onClose={onClose} onImported={onImported} {...props} />
    </AntdApp>,
  );
  return { ...utils, onClose, onImported };
}

// antd's Modal renders into a document.body portal, not the RTL render() container.
function fileInput() {
  return document.body.querySelector('input[type="file"]') as HTMLInputElement;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

describe('RosterImportModal', () => {
  it('shows the upload dragger when nothing has been selected', () => {
    renderModal();
    expect(screen.getByText(/click or drag a csv or excel/i)).toBeInTheDocument();
  });

  it('selecting a file previews it and pre-fills the guessed mapping', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        headers: ['Player Name', 'Jersey #', 'Email'],
        previewRows: [['Alex', '7', 'alex@example.com']],
        totalRows: 1,
        guessedMapping: { nameColumn: 0, playerNumberColumn: 1, emailColumn: 2 },
      }),
    } as Response);
    renderModal();

    const file = new File(
      ['Player Name,Jersey #,Email\nAlex,7,alex@example.com'],
      'roster.csv',
      { type: 'text/csv' },
    );
    await user.upload(fileInput(), file);

    expect(fetch).toHaveBeenCalledWith(
      '/api/admin/orders/order-1/roster/import/preview',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(await screen.findByText('1 row detected. Showing the first 1.')).toBeInTheDocument();
    expect(screen.getByText('Alex')).toBeInTheDocument();
  });

  it('shows an error and returns to the dragger when preview fails', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'The file is empty.' }),
    } as Response);
    renderModal();

    const file = new File([''], 'roster.csv', { type: 'text/csv' });
    await user.upload(fileInput(), file);

    expect(await screen.findByText('The file is empty.')).toBeInTheDocument();
    expect(screen.getByText(/click or drag a csv or excel/i)).toBeInTheDocument();
  });

  it('importing posts the file and mapping, then calls onImported and closes', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          headers: ['Name', 'Number', 'Email'],
          previewRows: [['Alex', '7', 'alex@example.com']],
          totalRows: 1,
          guessedMapping: { nameColumn: 0, playerNumberColumn: 1, emailColumn: 2 },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ imported: 1, skippedBlank: 0, skippedDuplicate: 0, members: [] }),
      } as Response);
    const { onImported, onClose } = renderModal();

    const file = new File(['Name,Number,Email\nAlex,7,alex@example.com'], 'roster.csv', { type: 'text/csv' });
    await user.upload(fileInput(), file);
    await screen.findByText(/1 row detected/i);

    await user.click(screen.getByRole('button', { name: /^import 1 row$/i }));

    const commitCall = vi.mocked(fetch).mock.calls[1];
    expect(commitCall[0]).toBe('/api/admin/orders/order-1/roster/import/commit');
    const body = commitCall[1]?.body as FormData;
    expect(body.get('mapping')).toBe(JSON.stringify({ nameColumn: 0, playerNumberColumn: 1, emailColumn: 2 }));
    expect(body.get('file')).toBeTruthy();

    expect(await screen.findByText(/imported 1 member/i)).toBeInTheDocument();
    expect(onImported).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('shows ambiguous duplicates for confirmation, then re-commits with the chosen resolution', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          headers: ['Name', 'Number', 'Email'],
          previewRows: [['Alex', '23', '']],
          totalRows: 1,
          guessedMapping: { nameColumn: 0, playerNumberColumn: 1, emailColumn: 2 },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          needsConfirmation: true,
          ambiguousDuplicates: [
            { name: 'Alex', existingNumber: '7', existingEmail: null, newNumber: '23', newEmail: null },
          ],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ imported: 1, skippedBlank: 0, skippedDuplicate: 0, skippedAmbiguous: 0, members: [] }),
      } as Response);
    const { onImported } = renderModal();

    const file = new File(['Name,Number,Email\nAlex,23,\n'], 'roster.csv', { type: 'text/csv' });
    await user.upload(fileInput(), file);
    await screen.findByText(/1 row detected/i);

    await user.click(screen.getByRole('button', { name: /^import 1 row$/i }));

    expect(await screen.findByText(/match an existing entry, but details differ/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /import as separate people/i }));

    const secondCommitCall = vi.mocked(fetch).mock.calls[2];
    const body = secondCommitCall[1]?.body as FormData;
    expect(body.get('duplicateResolution')).toBe('importAll');

    expect(await screen.findByText(/imported 1 member/i)).toBeInTheDocument();
    expect(onImported).toHaveBeenCalled();
  });

  it('flags exact duplicate rows visible in the preview before import is clicked', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        headers: ['Name', 'Number', 'Email'],
        previewRows: [
          ['Lamelo Ball', '1', ''],
          ['Lamelo Ball', '1', ''],
        ],
        totalRows: 2,
        guessedMapping: { nameColumn: 0, playerNumberColumn: 1, emailColumn: 2 },
      }),
    } as Response);
    renderModal();

    const file = new File(
      ['Name,Number,Email\nLamelo Ball,1,\nLamelo Ball,1,\n'],
      'roster.csv',
      { type: 'text/csv' },
    );
    await user.upload(fileInput(), file);
    await screen.findByText(/2 rows detected/i);

    expect(await screen.findByText(/look like the same person entered twice/i)).toBeInTheDocument();
    expect(screen.getByText('Duplicate')).toBeInTheDocument();
  });

  it('disables Import until a Name column is chosen', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        headers: ['Col A', 'Col B'],
        previewRows: [['x', 'y']],
        totalRows: 1,
        guessedMapping: { nameColumn: null, playerNumberColumn: null, emailColumn: null },
      }),
    } as Response);
    renderModal();

    const file = new File(['Col A,Col B\nx,y'], 'roster.csv', { type: 'text/csv' });
    await user.upload(fileInput(), file);
    await screen.findByText(/1 row detected/i);

    expect(screen.getByRole('button', { name: /^import 1 row$/i })).toBeDisabled();
  });
});
