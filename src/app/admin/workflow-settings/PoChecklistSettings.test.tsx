import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp } from 'antd';

vi.mock('@/lib/api-fetch', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-fetch')>('@/lib/api-fetch');
  return {
    ApiError: actual.ApiError,
    getJson: vi.fn(),
    postJson: vi.fn(),
    patchJson: vi.fn(),
  };
});

import { getJson, patchJson, postJson } from '@/lib/api-fetch';
import { PoChecklistSettings, type PoChecklistItemRow } from './PoChecklistSettings';

const URL = '/api/admin/purchase-orders/checklist-items';

function item(overrides: Partial<PoChecklistItemRow> = {}): PoChecklistItemRow {
  return {
    id: 'chk-1',
    label: 'Design file includes colours',
    autoRule: null,
    allowSidestep: true,
    sortOrder: 2,
    isActive: true,
    ...overrides,
  };
}

function renderView(canMutate: boolean, items: PoChecklistItemRow[]) {
  vi.mocked(getJson).mockResolvedValue({ items });
  return render(
    <AntdApp>
      <PoChecklistSettings canMutate={canMutate} />
    </AntdApp>,
  );
}

async function rowFor(label: string) {
  return (await screen.findByText(label)).closest('tr') as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PoChecklistSettings', () => {
  it('lists every check with its order, rule and toggles', async () => {
    renderView(true, [
      item({
        id: 'auto',
        label: 'At least one design file attached',
        autoRule: 'design_file_attached',
        allowSidestep: false,
        sortOrder: 1,
      }),
      item(),
    ]);

    expect(await screen.findByText('Design file includes colours')).toBeInTheDocument();
    expect(getJson).toHaveBeenCalledWith(URL, 'Failed to load the checklist');

    // An auto item names the rule in plain language; a manual one says Manual.
    const auto = await rowFor('At least one design file attached');
    expect(within(auto).getByText('1')).toBeInTheDocument();
    expect(within(auto).getByText('A design file is attached')).toBeInTheDocument();
    const manual = await rowFor('Design file includes colours');
    expect(within(manual).getByText('Manual')).toBeInTheDocument();

    expect(
      screen.getByRole('switch', { name: 'Can be sidestepped: Design file includes colours' }),
    ).toBeChecked();
    expect(
      screen.getByRole('switch', { name: 'Can be sidestepped: At least one design file attached' }),
    ).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'In use: Design file includes colours' })).toBeChecked();
  });

  it('shows a retired check rather than hiding it', async () => {
    renderView(true, [item({ isActive: false })]);

    expect(await screen.findByText('retired')).toBeInTheDocument();
    expect(
      screen.getByRole('switch', { name: 'In use: Design file includes colours' }),
    ).not.toBeChecked();
  });

  it('is read-only for a non-admin: no add, no edit, disabled switches', async () => {
    renderView(false, [item()]);
    await screen.findByText('Design file includes colours');

    expect(screen.queryByRole('button', { name: /add check/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(
      screen.getByRole('switch', { name: 'Can be sidestepped: Design file includes colours' }),
    ).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'In use: Design file includes colours' })).toBeDisabled();
  });

  it('toggling "can be sidestepped" PATCHes just that field', async () => {
    const user = userEvent.setup();
    renderView(true, [item({ allowSidestep: false })]);
    await screen.findByText('Design file includes colours');

    vi.mocked(patchJson).mockResolvedValueOnce({ item: item({ allowSidestep: true }) });
    await user.click(
      screen.getByRole('switch', { name: 'Can be sidestepped: Design file includes colours' }),
    );

    await vi.waitFor(() =>
      expect(patchJson).toHaveBeenCalledWith(
        `${URL}/chk-1`,
        { allowSidestep: true },
        'Failed to save the check',
      ),
    );
    await vi.waitFor(() =>
      expect(
        screen.getByRole('switch', { name: 'Can be sidestepped: Design file includes colours' }),
      ).toBeChecked(),
    );
  });

  it('retiring a check PATCHes isActive: false (there is no delete)', async () => {
    const user = userEvent.setup();
    renderView(true, [item()]);
    await screen.findByText('Design file includes colours');

    vi.mocked(patchJson).mockResolvedValueOnce({ item: item({ isActive: false }) });
    await user.click(screen.getByRole('switch', { name: 'In use: Design file includes colours' }));

    await vi.waitFor(() =>
      expect(patchJson).toHaveBeenCalledWith(
        `${URL}/chk-1`,
        { isActive: false },
        'Failed to save the check',
      ),
    );
    expect(await screen.findByText('retired')).toBeInTheDocument();
  });

  it('adds a check through the modal, defaulting to manual and not sidesteppable', async () => {
    const user = userEvent.setup();
    renderView(true, [item()]);
    await screen.findByText('Design file includes colours');

    await user.click(screen.getByRole('button', { name: /add check/i }));
    const dialog = await screen.findByRole('dialog');
    await user.type(
      within(dialog).getByPlaceholderText(/checked whether any fonts/i),
      'Colour book matches the artwork',
    );

    vi.mocked(postJson).mockResolvedValueOnce({ item: item({ id: 'chk-2' }) });
    vi.mocked(getJson).mockResolvedValueOnce({
      items: [item(), item({ id: 'chk-2', label: 'Colour book matches the artwork', sortOrder: 3 })],
    });
    await user.click(within(dialog).getByRole('button', { name: 'Add check' }));

    await vi.waitFor(() =>
      expect(postJson).toHaveBeenCalledWith(
        URL,
        {
          label: 'Colour book matches the artwork',
          // Manual = no auto rule; sidestep off unless it is asked for.
          autoRule: null,
          allowSidestep: false,
          // Appended to the end of the list it was opened against.
          sortOrder: 3,
        },
        'Failed to add the check',
      ),
    );
    expect(await screen.findByText('Check added')).toBeInTheDocument();
    expect(await screen.findByText('Colour book matches the artwork')).toBeInTheDocument();
  });

  it('adds an automatic check when a rule is chosen', async () => {
    const user = userEvent.setup();
    renderView(true, []);
    await vi.waitFor(() => expect(getJson).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: /add check/i }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByPlaceholderText(/checked whether any fonts/i), 'Colour book set');
    await user.click(within(dialog).getByText('Manual — someone ticks it'));
    await user.click(await screen.findByText('Automatic — a colour book is chosen'));

    vi.mocked(postJson).mockResolvedValueOnce({ item: item() });
    vi.mocked(getJson).mockResolvedValueOnce({ items: [] });
    await user.click(within(dialog).getByRole('button', { name: 'Add check' }));

    await vi.waitFor(() =>
      expect(postJson).toHaveBeenCalledWith(
        URL,
        expect.objectContaining({ label: 'Colour book set', autoRule: 'color_book_set' }),
        'Failed to add the check',
      ),
    );
  });

  it('edits a check through the modal', async () => {
    const user = userEvent.setup();
    renderView(true, [item({ allowSidestep: false })]);
    const row = await rowFor('Design file includes colours');

    await user.click(within(row).getByRole('button', { name: /edit/i }));
    const dialog = await screen.findByRole('dialog');
    const label = within(dialog).getByDisplayValue('Design file includes colours');
    await user.clear(label);
    await user.type(label, 'Design file includes Pantone colours');
    // Make it skippable-with-a-reason from the same form.
    await user.click(within(dialog).getByRole('switch'));

    vi.mocked(patchJson).mockResolvedValueOnce({ item: item() });
    vi.mocked(getJson).mockResolvedValueOnce({
      items: [item({ label: 'Design file includes Pantone colours' })],
    });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await vi.waitFor(() =>
      expect(patchJson).toHaveBeenCalledWith(
        `${URL}/chk-1`,
        {
          label: 'Design file includes Pantone colours',
          autoRule: null,
          allowSidestep: true,
          sortOrder: 2,
        },
        'Failed to save the check',
      ),
    );
    expect(await screen.findByText('Design file includes Pantone colours')).toBeInTheDocument();
  });

  it('refuses to save a check with no label', async () => {
    const user = userEvent.setup();
    renderView(true, []);
    await vi.waitFor(() => expect(getJson).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: /add check/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Add check' }));

    expect(await screen.findByText('Say what has to be checked')).toBeInTheDocument();
    expect(postJson).not.toHaveBeenCalled();
  });

  it('surfaces a failed save without dropping the row', async () => {
    const user = userEvent.setup();
    renderView(true, [item({ allowSidestep: false })]);
    await screen.findByText('Design file includes colours');

    vi.mocked(patchJson).mockRejectedValueOnce(new Error('Nope'));
    await user.click(
      screen.getByRole('switch', { name: 'Can be sidestepped: Design file includes colours' }),
    );

    expect(await screen.findByText('Nope')).toBeInTheDocument();
    expect(
      screen.getByRole('switch', { name: 'Can be sidestepped: Design file includes colours' }),
    ).not.toBeChecked();
  });
});
