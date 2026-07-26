import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp } from 'antd';

vi.mock('@/lib/api-fetch', () => ({
  getJson: vi.fn(),
  postJson: vi.fn(),
  patchJson: vi.fn(),
}));

import { getJson, postJson, patchJson } from '@/lib/api-fetch';
import { SuppliersView, type SupplierRow } from './SuppliersView';

function supplier(overrides: Partial<SupplierRow> = {}): SupplierRow {
  return {
    id: 'sup-1',
    name: 'Dongguan Apparel',
    supplierCode: 'DG',
    contactPerson: 'Li Wei',
    email: 'sales@dongguan.example',
    phone: null,
    website: null,
    address: null,
    specialties: ['hoodies', 'sublimation'],
    minimumOrderQuantity: 50,
    leadTimeWeeks: 4,
    notes: null,
    isActive: true,
    ...overrides,
  };
}

function renderView(role: 'sales' | 'admin', suppliers: SupplierRow[]) {
  vi.mocked(getJson).mockResolvedValueOnce(suppliers);
  return render(
    <AntdApp>
      <SuppliersView role={role} />
    </AntdApp>,
  );
}

async function rowFor(name: string) {
  return (await screen.findByText(name)).closest('tr') as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SuppliersView', () => {
  it('fetches and renders a row per supplier with code, contact, specialties, MOQ and lead time', async () => {
    renderView('admin', [supplier()]);

    expect(await screen.findByText('Dongguan Apparel')).toBeInTheDocument();
    expect(getJson).toHaveBeenCalledWith('/api/admin/suppliers', 'Failed to load suppliers');

    const row = await rowFor('Dongguan Apparel');
    expect(within(row).getByText('DG')).toBeInTheDocument();
    expect(within(row).getByText('Li Wei')).toBeInTheDocument();
    expect(within(row).getByText('sales@dongguan.example')).toBeInTheDocument();
    expect(within(row).getByText('hoodies')).toBeInTheDocument();
    expect(within(row).getByText('sublimation')).toBeInTheDocument();
    expect(within(row).getByText('50')).toBeInTheDocument();
    expect(within(row).getByText('4')).toBeInTheDocument();
    expect(within(row).getByRole('switch')).toBeChecked();
  });

  it('shows an Inactive tag and an unchecked switch for a deactivated supplier', async () => {
    renderView('admin', [supplier({ isActive: false })]);

    expect(await screen.findByText('Inactive')).toBeInTheDocument();
    const row = await rowFor('Dongguan Apparel');
    expect(within(row).getByRole('switch')).not.toBeChecked();
  });

  it('renders read-only for the sales role: no New Supplier button, disabled switch, no edit', async () => {
    renderView('sales', [supplier()]);

    const row = await rowFor('Dongguan Apparel');
    expect(screen.queryByRole('button', { name: /new supplier/i })).not.toBeInTheDocument();
    expect(within(row).getByRole('switch')).toBeDisabled();
    expect(within(row).queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
  });

  it('creates a supplier through the modal and appends the row', async () => {
    const user = userEvent.setup();
    renderView('admin', []);
    await vi.waitFor(() => expect(getJson).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: /new supplier/i }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByPlaceholderText('e.g. Dongguan Apparel Co.'), 'Fabrico');
    await user.type(within(dialog).getByPlaceholderText('e.g. DG'), 'FB');

    vi.mocked(postJson).mockResolvedValueOnce(
      supplier({ id: 'sup-new', name: 'Fabrico', supplierCode: 'FB', specialties: [] }),
    );
    await user.click(within(dialog).getByRole('button', { name: /create/i }));

    await vi.waitFor(() =>
      expect(postJson).toHaveBeenCalledWith(
        '/api/admin/suppliers',
        // Create omits empty optional fields instead of sending null.
        { name: 'Fabrico', supplierCode: 'FB', specialties: [], isActive: true },
        'Failed to create supplier',
      ),
    );
    expect(await screen.findByText('Supplier created')).toBeInTheDocument();
    expect(await screen.findByText('Fabrico')).toBeInTheDocument();
  });

  it('editing a supplier PATCHes with null for cleared fields and updates the row', async () => {
    const user = userEvent.setup();
    renderView('admin', [supplier()]);

    const row = await rowFor('Dongguan Apparel');
    await user.click(within(row).getByRole('button', { name: /edit/i }));
    const dialog = await screen.findByRole('dialog');

    const nameInput = within(dialog).getByPlaceholderText('e.g. Dongguan Apparel Co.');
    await user.clear(nameInput);
    await user.type(nameInput, 'Dongguan Apparel (New)');

    vi.mocked(patchJson).mockResolvedValueOnce(supplier({ name: 'Dongguan Apparel (New)' }));
    await user.click(within(dialog).getByRole('button', { name: /save/i }));

    await vi.waitFor(() =>
      expect(patchJson).toHaveBeenCalledWith(
        '/api/admin/suppliers/sup-1',
        expect.objectContaining({
          name: 'Dongguan Apparel (New)',
          contactPerson: 'Li Wei',
          // Empty optional fields are cleared with null on update.
          phone: null,
          website: null,
          notes: null,
          address: null,
        }),
        'Failed to save supplier',
      ),
    );
    expect(await screen.findByText('Supplier updated')).toBeInTheDocument();
    expect(await screen.findByText('Dongguan Apparel (New)')).toBeInTheDocument();
  });

  it('toggling the Active switch PATCHes isActive and shows a message', async () => {
    const user = userEvent.setup();
    renderView('admin', [supplier()]);

    const row = await rowFor('Dongguan Apparel');
    vi.mocked(patchJson).mockResolvedValueOnce(supplier({ isActive: false }));
    await user.click(within(row).getByRole('switch'));

    await vi.waitFor(() =>
      expect(patchJson).toHaveBeenCalledWith(
        '/api/admin/suppliers/sup-1',
        { isActive: false },
        'Failed to update supplier',
      ),
    );
    expect(await screen.findByText('Supplier deactivated')).toBeInTheDocument();
    expect(await screen.findByText('Inactive')).toBeInTheDocument();
  });

  it('shows the server error message when saving fails', async () => {
    const user = userEvent.setup();
    renderView('admin', []);
    await vi.waitFor(() => expect(getJson).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: /new supplier/i }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByPlaceholderText('e.g. Dongguan Apparel Co.'), 'Dupe Co');
    await user.type(within(dialog).getByPlaceholderText('e.g. DG'), 'DG');

    vi.mocked(postJson).mockRejectedValueOnce(new Error('Supplier code already in use'));
    await user.click(within(dialog).getByRole('button', { name: /create/i }));

    expect(await screen.findByText('Supplier code already in use')).toBeInTheDocument();
  });
});
