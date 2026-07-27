import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import { GarmentsMasterDetail } from './GarmentsMasterDetail';

let searchParamsValue = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParamsValue,
}));

// The component fetches the garment-types list on mount via getJson; stub it
// so that call never touches the global fetch mock (whose *Once queues drive
// the user-action assertions below).
vi.mock('@/lib/api-fetch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-fetch')>();
  return { ...actual, getJson: vi.fn().mockResolvedValue([]) };
});

vi.mock('./MockupUploader', () => ({ MockupUploader: () => <div data-testid="mockup-uploader" /> }));
vi.mock('./SizingTable', () => ({ SizingTable: () => <div data-testid="sizing-table" /> }));
vi.mock('./SizeChartLinker', () => ({ SizeChartLinker: () => <div data-testid="size-chart-linker" /> }));

function garment(overrides: Partial<Parameters<typeof GarmentsMasterDetail>[0]['initialGarments'][number]> = {}) {
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

function renderView(initialGarments: ReturnType<typeof garment>[] = []) {
  return render(
    <AntdApp>
      <GarmentsMasterDetail
        orderId="order-1"
        initialGarments={initialGarments}
        currentUserId="staff-1"
        isAdmin={false}
      />
    </AntdApp>,
  );
}

beforeEach(() => {
  searchParamsValue = new URLSearchParams();
  vi.stubGlobal('fetch', vi.fn());
});

describe('GarmentsMasterDetail', () => {
  it('shows an empty state when there are no garments', () => {
    renderView([]);
    expect(screen.getByText(/no garments added yet/i)).toBeInTheDocument();
  });

  it('renders the first garment selected in the list with its editor open', () => {
    renderView([garment({ name: 'Home Jersey' })]);
    expect(screen.getByRole('menuitem', { name: /home jersey/i })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Home Jersey')).toBeInTheDocument();
    expect(screen.getByTestId('mockup-uploader')).toBeInTheDocument();
    expect(screen.getByTestId('sizing-table')).toBeInTheDocument();
    expect(screen.getByTestId('size-chart-linker')).toBeInTheDocument();
  });

  it('selecting another garment in the list switches the detail editor', async () => {
    const user = userEvent.setup();
    renderView([
      garment({ id: 'garment-1', name: 'Home Jersey' }),
      garment({ id: 'garment-2', name: 'Away Jersey' }),
    ]);

    expect(screen.getByDisplayValue('Home Jersey')).toBeInTheDocument();

    await user.click(screen.getByRole('menuitem', { name: /away jersey/i }));

    expect(screen.getByDisplayValue('Away Jersey')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Home Jersey')).not.toBeInTheDocument();
  });

  it('honors the "garment" URL search param for initial selection', () => {
    searchParamsValue = new URLSearchParams('garment=garment-2');
    renderView([
      garment({ id: 'garment-1', name: 'Home Jersey' }),
      garment({ id: 'garment-2', name: 'Away Jersey' }),
    ]);

    expect(screen.getByDisplayValue('Away Jersey')).toBeInTheDocument();
  });

  it('adding a garment with a blank name shows a warning and does not call fetch', async () => {
    const user = userEvent.setup();
    renderView([]);

    await user.click(screen.getByRole('button', { name: /add garment/i }));

    expect(await screen.findByText(/enter a garment name/i)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('adding a garment POSTs the name, appends it, and selects it', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'garment-2', name: 'Away Jersey', fabrics: [], notes: null, sortOrder: 0 }),
    } as Response);
    renderView([]);

    await user.type(screen.getByPlaceholderText(/new garment name/i), 'Away Jersey');
    await user.click(screen.getByRole('button', { name: /add garment/i }));

    expect(fetch).toHaveBeenCalledWith('/api/admin/orders/order-1/garments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Away Jersey' }),
    });
    expect(await screen.findByText(/garment added/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue('Away Jersey')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/new garment name/i)).toHaveValue('');
  });

  it('shows an error message when adding a garment fails', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, json: async () => ({}) } as Response);
    renderView([]);

    await user.type(screen.getByPlaceholderText(/new garment name/i), 'Away Jersey');
    await user.click(screen.getByRole('button', { name: /add garment/i }));

    expect(await screen.findByText(/failed to add garment/i)).toBeInTheDocument();
  });

  it('editing the garment name shows an unsaved marker and Save/Discard controls', async () => {
    const user = userEvent.setup();
    renderView([garment({ name: 'Home Jersey' })]);

    const nameInput = screen.getByDisplayValue('Home Jersey');
    await user.clear(nameInput);
    await user.type(nameInput, 'Home Jersey V2');

    expect(screen.getByTitle('Unsaved changes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /discard/i })).toBeInTheDocument();
  });

  it('saving an edited garment PATCHes it and clears the unsaved marker', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) } as Response);
    renderView([garment({ name: 'Home Jersey' })]);

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
    expect(screen.queryByTitle('Unsaved changes')).not.toBeInTheDocument();
  });

  it('discarding an edit reverts the field and hides Save/Discard', async () => {
    const user = userEvent.setup();
    renderView([garment({ name: 'Home Jersey' })]);

    const nameInput = screen.getByDisplayValue('Home Jersey');
    await user.clear(nameInput);
    await user.type(nameInput, 'Something else');
    await user.click(screen.getByRole('button', { name: /discard/i }));

    expect(screen.getByDisplayValue('Home Jersey')).toBeInTheDocument();
    expect(screen.queryByTitle('Unsaved changes')).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('deleting a garment asks for confirmation, then DELETEs it and shows the empty state', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) } as Response);
    renderView([garment({ id: 'garment-1', name: 'Home Jersey' })]);

    await user.click(screen.getByRole('button', { name: /delete garment/i }));
    const confirmButton = await screen.findByRole('button', { name: 'Delete' });
    await user.click(confirmButton);

    expect(fetch).toHaveBeenCalledWith('/api/admin/orders/order-1/garments/garment-1', { method: 'DELETE' });
    expect(await screen.findByText(/garment removed/i)).toBeInTheDocument();
    expect(screen.getByText(/no garments added yet/i)).toBeInTheDocument();
  });

  it('deleting the selected garment selects the next remaining garment', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) } as Response);
    renderView([
      garment({ id: 'garment-1', name: 'Home Jersey' }),
      garment({ id: 'garment-2', name: 'Away Jersey' }),
    ]);

    await user.click(screen.getByRole('button', { name: /delete garment/i }));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));

    expect(await screen.findByText(/garment removed/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue('Away Jersey')).toBeInTheDocument();
  });
});
