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

  it('saving POSTs the rows (empty strings become null) and shows a success message', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) } as Response);
    renderTable({
      initialRows: [{ id: 'row-1', size: 'M', playerName: 'Alice', playerNumber: '', notes: '' }],
    });

    await user.click(screen.getByRole('button', { name: /save sizing/i }));

    expect(fetch).toHaveBeenCalledWith(
      '/api/admin/orders/order-1/garments/garment-1/sizing',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          { size: 'M', playerName: 'Alice', playerNumber: null, notes: null, sortOrder: 0 },
        ]),
      }),
    );
    expect(await screen.findByText(/sizing saved/i)).toBeInTheDocument();
  });

  it('shows an error message when saving fails', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, json: async () => ({}) } as Response);
    renderTable({ initialRows: [] });

    await user.click(screen.getByRole('button', { name: /save sizing/i }));

    expect(await screen.findByText(/failed to save sizing/i)).toBeInTheDocument();
  });
});
