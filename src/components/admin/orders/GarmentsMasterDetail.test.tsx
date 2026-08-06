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
import { getJson } from '@/lib/api-fetch';

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

  // The 2026-08-06 restructure: the garment editor's sections are distinct
  // titled cards, matching the PO page's look.
  it('lays the garment editor out as titled section cards', () => {
    renderView([garment()]);

    for (const title of ['Garment', 'Mock-up Images', 'Sizing', 'Reference Size Charts']) {
      const el = screen.getByText(title);
      expect(el.closest('.ant-card'), `"${title}" should be a card title`).not.toBeNull();
    }
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

  // The add flow (David, 2026-08-03): "Add garment" opens a BLANK FORM in the
  // detail pane; the garment is created on "Save garment".
  it('saving the blank form with no name shows a warning and does not call fetch', async () => {
    const user = userEvent.setup();
    renderView([]);

    await user.click(screen.getByRole('button', { name: /add garment/i }));
    await user.click(screen.getByRole('button', { name: /save garment/i }));

    expect(await screen.findByText(/enter a garment name/i)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('filling the blank form and saving POSTs, appends and selects the garment', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'garment-2', name: 'Away Jersey', fabrics: [], notes: null, sortOrder: 0 }),
    } as Response);
    renderView([]);

    await user.click(screen.getByRole('button', { name: /add garment/i }));
    await user.type(screen.getByPlaceholderText(/home jersey/i), 'Away Jersey');
    await user.click(screen.getByRole('button', { name: /save garment/i }));

    expect(fetch).toHaveBeenCalledWith('/api/admin/orders/order-1/garments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Away Jersey' }),
    });
    expect(await screen.findByText(/garment added/i)).toBeInTheDocument();
    // The draft closes and the created garment's editor is selected.
    expect(screen.getByDisplayValue('Away Jersey')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save garment/i })).not.toBeInTheDocument();
  });

  it('shows an error message when adding a garment fails', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, json: async () => ({}) } as Response);
    renderView([]);

    await user.click(screen.getByRole('button', { name: /add garment/i }));
    await user.type(screen.getByPlaceholderText(/home jersey/i), 'Away Jersey');
    await user.click(screen.getByRole('button', { name: /save garment/i }));

    expect(await screen.findByText(/failed to add garment/i)).toBeInTheDocument();
  });

  it('cancelling the blank form returns to the previously selected garment', async () => {
    const user = userEvent.setup();
    renderView([garment({ name: 'Home Jersey' })]);

    await user.click(screen.getByRole('button', { name: /add garment/i }));
    expect(screen.getByRole('button', { name: /save garment/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(screen.queryByRole('button', { name: /save garment/i })).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('Home Jersey')).toBeInTheDocument();
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

// Required options (David, 2026-08-06): "the sales person MUST choose a colour
// for the cord of the shorts" — required + visible + empty blocks the save.
describe('GarmentsMasterDetail required options', () => {
  const SHORTS_TYPE = {
    id: 'type-1',
    name: 'Shorts',
    category: null,
    fabricFields: [],
    orderOptions: [
      { label: 'Cord Color', type: 'text', required: true },
      { label: 'Zip Type', type: 'select', options: ['full-zip', 'pullover'] },
    ],
    sizeChartIds: [],
    isActive: true,
  };

  function typedGarment(selectedOptions: Record<string, string>) {
    return garment({ garmentTypeId: 'type-1', selectedOptions });
  }

  it('marks a required option with the antd required asterisk, non-required not', async () => {
    vi.mocked(getJson).mockResolvedValueOnce([SHORTS_TYPE]);
    renderView([typedGarment({ 'Cord Color': 'Black' })]);

    expect(await screen.findByText('Cord Color')).toHaveClass('ant-form-item-required');
    expect(screen.getByText('Zip Type')).not.toHaveClass('ant-form-item-required');
  });

  it('blocks the save client-side, naming the option, when a visible required option is emptied', async () => {
    const user = userEvent.setup();
    vi.mocked(getJson).mockResolvedValueOnce([SHORTS_TYPE]);
    renderView([typedGarment({ 'Cord Color': 'Black' })]);

    await user.clear(await screen.findByDisplayValue('Black'));
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText('Required options not set: Cord Color')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('saves normally once the required option has a value', async () => {
    const user = userEvent.setup();
    vi.mocked(getJson).mockResolvedValueOnce([SHORTS_TYPE]);
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) } as Response);
    renderView([typedGarment({ 'Cord Color': 'Black' })]);

    const cordInput = await screen.findByDisplayValue('Black');
    await user.clear(cordInput);
    await user.type(cordInput, 'White');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText(/garment saved/i)).toBeInTheDocument();
    const patchCall = vi.mocked(fetch).mock.calls[0];
    expect(JSON.parse(patchCall[1]!.body as string).selectedOptions).toEqual({
      'Cord Color': 'White',
    });
  });

  it("surfaces the server's 409 message when a save slips past the client check", async () => {
    const user = userEvent.setup();
    vi.mocked(getJson).mockResolvedValueOnce([SHORTS_TYPE]);
    // A rename does not touch options/type, so the client check is skipped —
    // the server may still 409 (e.g. the required flag was added after the
    // garment was configured).
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: 'Required options not set: Cord Color' }),
    } as Response);
    renderView([typedGarment({ 'Cord Color': '' })]);

    const nameInput = await screen.findByDisplayValue('Home Jersey');
    await user.type(nameInput, ' V2');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText('Required options not set: Cord Color')).toBeInTheDocument();
  });
});
