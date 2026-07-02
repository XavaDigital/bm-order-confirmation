import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import { GarmentAccordion } from './GarmentAccordion';

vi.mock('./MockupUploader', () => ({ MockupUploader: () => <div data-testid="mockup-uploader" /> }));
vi.mock('./SizingTable', () => ({ SizingTable: () => <div data-testid="sizing-table" /> }));
vi.mock('./SizeChartLinker', () => ({ SizeChartLinker: () => <div data-testid="size-chart-linker" /> }));

function garment(overrides: Partial<Parameters<typeof GarmentAccordion>[0]['initialGarments'][number]> = {}) {
  return {
    id: 'garment-1',
    name: 'Home Jersey',
    fabrics: [],
    notes: null,
    sortOrder: 0,
    sizing: [],
    images: [],
    sizeChartIds: [],
    ...overrides,
  };
}

function renderAccordion(initialGarments: ReturnType<typeof garment>[] = []) {
  return render(
    <AntdApp>
      <GarmentAccordion orderId="order-1" initialGarments={initialGarments} />
    </AntdApp>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

describe('GarmentAccordion', () => {
  it('shows an empty state and no collapse when there are no garments', () => {
    renderAccordion([]);
    expect(screen.getByText(/no garments added yet/i)).toBeInTheDocument();
  });

  it('renders an existing garment name in the collapse header', () => {
    renderAccordion([garment({ name: 'Home Jersey' })]);
    expect(screen.getByText('Home Jersey')).toBeInTheDocument();
  });

  it('adding a garment with a blank name shows a warning and does not call fetch', async () => {
    const user = userEvent.setup();
    renderAccordion([]);

    await user.click(screen.getByRole('button', { name: /add garment/i }));

    expect(await screen.findByText(/enter a garment name/i)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('adding a garment POSTs the name and appends the returned garment to the list', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'garment-2', name: 'Away Jersey', fabrics: [], notes: null, sortOrder: 0 }),
    } as Response);
    renderAccordion([]);

    await user.type(screen.getByPlaceholderText(/new garment name/i), 'Away Jersey');
    await user.click(screen.getByRole('button', { name: /add garment/i }));

    expect(fetch).toHaveBeenCalledWith('/api/admin/orders/order-1/garments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Away Jersey' }),
    });
    expect(await screen.findByText('Away Jersey')).toBeInTheDocument();
    expect(await screen.findByText(/garment added/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/new garment name/i)).toHaveValue('');
  });

  it('shows an error message when adding a garment fails, without clearing the input', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response);
    renderAccordion([]);

    await user.type(screen.getByPlaceholderText(/new garment name/i), 'Away Jersey');
    await user.click(screen.getByRole('button', { name: /add garment/i }));

    expect(await screen.findByText(/failed to add garment/i)).toBeInTheDocument();
  });

  it('editing the garment name shows an unsaved badge and Save/Discard controls', async () => {
    const user = userEvent.setup();
    renderAccordion([garment({ name: 'Home Jersey' })]);

    const nameInput = screen.getByDisplayValue('Home Jersey');
    await user.clear(nameInput);
    await user.type(nameInput, 'Home Jersey V2');

    expect(screen.getByText('(unsaved)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /discard/i })).toBeInTheDocument();
  });

  it('saving an edited garment PATCHes it and clears the unsaved badge', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response);
    renderAccordion([garment({ name: 'Home Jersey' })]);

    const nameInput = screen.getByDisplayValue('Home Jersey');
    await user.clear(nameInput);
    await user.type(nameInput, 'Home Jersey V2');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(fetch).toHaveBeenCalledWith('/api/admin/orders/order-1/garments/garment-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Home Jersey V2', fabrics: [], notes: null }),
    });
    expect(await screen.findByText(/garment saved/i)).toBeInTheDocument();
    expect(screen.queryByText('(unsaved)')).not.toBeInTheDocument();
  });

  it('discarding an edit reverts the field and hides Save/Discard', async () => {
    const user = userEvent.setup();
    renderAccordion([garment({ name: 'Home Jersey' })]);

    const nameInput = screen.getByDisplayValue('Home Jersey');
    await user.clear(nameInput);
    await user.type(nameInput, 'Something else');
    await user.click(screen.getByRole('button', { name: /discard/i }));

    expect(screen.getByDisplayValue('Home Jersey')).toBeInTheDocument();
    expect(screen.queryByText('(unsaved)')).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('deleting a garment asks for confirmation, then DELETEs it and removes it from the list', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response);
    renderAccordion([garment({ id: 'garment-1', name: 'Home Jersey' })]);

    await user.click(screen.getByRole('button', { name: /delete garment/i }));
    const confirmButton = await screen.findByRole('button', { name: 'Delete' });
    await user.click(confirmButton);

    expect(fetch).toHaveBeenCalledWith('/api/admin/orders/order-1/garments/garment-1', { method: 'DELETE' });
    expect(await screen.findByText(/garment removed/i)).toBeInTheDocument();
    expect(screen.getByText(/no garments added yet/i)).toBeInTheDocument();
  });
});
