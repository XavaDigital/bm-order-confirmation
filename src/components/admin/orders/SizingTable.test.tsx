import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import { SizingTable } from './SizingTable';

function renderTable(props: Partial<React.ComponentProps<typeof SizingTable>> = {}) {
  return render(
    <AntdApp>
      <SizingTable orderId="order-1" garmentId="garment-1" initialRows={[]} {...props} />
    </AntdApp>,
  );
}

function dataRows() {
  // First row in a antd Table's tbody is a header-less data row; select all data rows.
  return screen.getAllByRole('row').filter((r) => within(r).queryAllByRole('cell').length > 0);
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

describe('SizingTable', () => {
  it('renders initial rows with values pre-filled', () => {
    renderTable({
      initialRows: [{ id: 'row-1', size: 'M', playerName: 'Alice', playerNumber: '7', notes: 'note' }],
    });

    expect(screen.getByDisplayValue('M')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Alice')).toBeInTheDocument();
    expect(screen.getByDisplayValue('7')).toBeInTheDocument();
    expect(screen.getByDisplayValue('note')).toBeInTheDocument();
  });

  it('shows an empty state when there are no rows', () => {
    renderTable({ initialRows: [] });
    expect(screen.getByText(/no sizing rows yet/i)).toBeInTheDocument();
  });

  it('adding a row creates a new empty editable row', async () => {
    const user = userEvent.setup();
    renderTable({ initialRows: [] });

    await user.click(screen.getByRole('button', { name: /add row/i }));

    expect(dataRows()).toHaveLength(1);
    expect(screen.getByPlaceholderText('S / M / L…')).toHaveValue('');
  });

  it('editing a cell updates its value', async () => {
    const user = userEvent.setup();
    renderTable({ initialRows: [{ id: 'row-1', size: '', playerName: '', playerNumber: '', notes: '' }] });

    const sizeInput = screen.getByPlaceholderText('S / M / L…');
    await user.type(sizeInput, 'L');

    expect(sizeInput).toHaveValue('L');
  });

  it('removing a row asks for confirmation and then removes it', async () => {
    const user = userEvent.setup();
    renderTable({
      initialRows: [{ id: 'row-1', size: 'M', playerName: 'Alice', playerNumber: '7', notes: '' }],
    });

    expect(dataRows()).toHaveLength(1);
    const deleteButtons = screen.getAllByRole('button').filter((b) => b.querySelector('.anticon-delete'));
    await user.click(deleteButtons[0]);

    const confirmButton = await screen.findByRole('button', { name: 'Remove' });
    await user.click(confirmButton);

    expect(screen.getByText(/no sizing rows yet/i)).toBeInTheDocument();
  });

  it('saving POSTs the rows with their ids (empty strings become null) and shows a success message', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        rows: [{ id: 'row-1', size: 'M', playerName: 'Alice', playerNumber: null, notes: null }],
      }),
    } as Response);
    renderTable({
      initialRows: [{ id: 'row-1', size: 'M', playerName: 'Alice', playerNumber: '', notes: '' }],
    });

    await user.click(screen.getByRole('button', { name: /save sizing/i }));

    expect(fetch).toHaveBeenCalledWith(
      '/api/admin/orders/order-1/garments/garment-1/sizing',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Saved rows carry their id so the server updates in place (stable
        // UUIDs for roster attribution + PO snapshots).
        body: JSON.stringify([
          {
            id: 'row-1',
            size: 'M',
            playerName: 'Alice',
            playerNumber: null,
            notes: null,
            customValues: {},
            sortOrder: 0,
          },
        ]),
      }),
    );
    expect(await screen.findByText(/sizing saved/i)).toBeInTheDocument();
  });

  it('re-seeds local rows with server ids after save so a second save updates in place', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          rows: [{ id: 'srv-1', size: 'M', playerName: null, playerNumber: null, notes: null }],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          rows: [{ id: 'srv-1', size: 'M', playerName: null, playerNumber: null, notes: null }],
        }),
      } as Response);
    renderTable({ initialRows: [] });

    await user.click(screen.getByRole('button', { name: /add row/i }));
    await user.click(screen.getByRole('button', { name: /save sizing/i }));
    expect(await screen.findByText(/sizing saved/i)).toBeInTheDocument();

    // First save sent no id (new row)…
    const firstBody = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(firstBody[0].id).toBeUndefined();

    // …second save carries the id returned by the server.
    await user.click(screen.getByRole('button', { name: /save sizing/i }));
    const secondBody = JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string);
    expect(secondBody[0].id).toBe('srv-1');
  });

  it('shows an error message when saving fails', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, json: async () => ({}) } as Response);
    renderTable({ initialRows: [] });

    await user.click(screen.getByRole('button', { name: /save sizing/i }));

    expect(await screen.findByText(/failed to save sizing/i)).toBeInTheDocument();
  });

  describe('custom columns', () => {
    const colour = { label: 'Colour', type: 'select' as const, options: ['Navy', 'Red'] };
    const sponsor = { label: 'Sponsor', type: 'text' as const };

    it('renders a column per definition, between # and Notes', () => {
      renderTable({
        initialRows: [{ id: 'row-1', size: 'M', playerName: '', playerNumber: '', notes: '' }],
        sizingColumns: [colour, sponsor],
      });

      const headers = screen.getAllByRole('columnheader').map((h) => h.textContent ?? '');
      const colourIdx = headers.findIndex((h) => h.includes('Colour'));
      const notesIdx = headers.findIndex((h) => h.includes('Notes'));
      const numberIdx = headers.findIndex((h) => h.trim() === '#');
      expect(colourIdx).toBeGreaterThan(numberIdx);
      expect(colourIdx).toBeLessThan(notesIdx);
      expect(headers.some((h) => h.includes('Sponsor'))).toBe(true);
    });

    it('pre-fills existing custom values', () => {
      renderTable({
        initialRows: [
          {
            id: 'row-1',
            size: 'M',
            playerName: '',
            playerNumber: '',
            notes: '',
            customValues: { Sponsor: 'Acme Ltd' },
          },
        ],
        sizingColumns: [sponsor],
      });

      expect(screen.getByDisplayValue('Acme Ltd')).toBeInTheDocument();
    });

    it('sends edited custom values in the save payload', async () => {
      const user = userEvent.setup();
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, rows: [] }),
      } as Response);
      renderTable({
        initialRows: [{ id: 'row-1', size: 'M', playerName: '', playerNumber: '', notes: '' }],
        sizingColumns: [sponsor],
      });

      await user.type(screen.getByPlaceholderText('Sponsor'), 'Acme');
      await user.click(screen.getByRole('button', { name: /save sizing/i }));

      const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
      expect(body[0].customValues).toEqual({ Sponsor: 'Acme' });
    });

    it('hides the column controls when the garment cannot be edited', () => {
      renderTable({ initialRows: [], sizingColumns: [colour] });

      // No onColumnsChange -> read-only columns, no add/edit/remove affordances.
      expect(screen.queryByRole('button', { name: /add column/i })).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Edit column Colour' }),
      ).not.toBeInTheDocument();
    });

    it('adds a free-text column through the modal', async () => {
      const user = userEvent.setup();
      const onColumnsChange = vi.fn().mockResolvedValue(undefined);
      renderTable({ initialRows: [], sizingColumns: [], onColumnsChange });

      // Two buttons match /add column/i once the modal is open (the toolbar
      // trigger and the modal's OK) — the modal's is last in the DOM.
      await user.click(screen.getByRole('button', { name: /add column/i }));
      await user.type(screen.getByPlaceholderText(/e.g. Colour/i), 'Flag');
      const okButtons = screen.getAllByRole('button', { name: /add column/i });
      await user.click(okButtons[okButtons.length - 1]);

      expect(onColumnsChange).toHaveBeenCalledWith([{ label: 'Flag', type: 'text' }]);
    });

    it('rejects a duplicate column name', async () => {
      const user = userEvent.setup();
      const onColumnsChange = vi.fn();
      renderTable({ initialRows: [], sizingColumns: [sponsor], onColumnsChange });

      await user.click(screen.getByRole('button', { name: /add column/i }));
      await user.type(screen.getByPlaceholderText(/e.g. Colour/i), 'sponsor');
      const okButtons = screen.getAllByRole('button', { name: /add column/i });
      await user.click(okButtons[okButtons.length - 1]);

      expect(await screen.findByText(/already exists on this garment/i)).toBeInTheDocument();
      expect(onColumnsChange).not.toHaveBeenCalled();
    });

    it('removing a column persists the shorter set', async () => {
      const user = userEvent.setup();
      const onColumnsChange = vi.fn().mockResolvedValue(undefined);
      renderTable({ initialRows: [], sizingColumns: [colour, sponsor], onColumnsChange });

      await user.click(screen.getByRole('button', { name: 'Remove column Colour' }));
      await user.click(await screen.findByRole('button', { name: 'Remove' }));

      expect(onColumnsChange).toHaveBeenCalledWith([sponsor]);
    });
  });
});
