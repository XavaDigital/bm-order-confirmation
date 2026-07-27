import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import { OrderAssetsPanel, type OrderAsset } from './OrderAssetsPanel';

vi.mock('@/lib/api-fetch', () => ({
  getJson: vi.fn(),
  postJson: vi.fn(),
  patchJson: vi.fn(),
  deleteJson: vi.fn(),
  ApiError: class ApiError extends Error {},
}));

import { getJson, patchJson, postJson, deleteJson } from '@/lib/api-fetch';

const GARMENTS = [
  { id: 'g1', name: 'Home Jersey' },
  { id: 'g2', name: 'Shorts' },
];

function asset(overrides: Partial<OrderAsset> = {}): OrderAsset {
  return {
    id: 'a1',
    kind: 'design',
    name: 'Front print AI',
    url: 'https://drive.example/abc',
    notes: null,
    garmentId: null,
    includeOnPo: false,
    sortOrder: 0,
    garment: null,
    ...overrides,
  };
}

function renderPanel() {
  return render(
    <AntdApp>
      <OrderAssetsPanel orderId="order-1" garments={GARMENTS} />
    </AntdApp>,
  );
}

beforeEach(() => {
  vi.mocked(getJson).mockReset().mockResolvedValue([]);
  vi.mocked(postJson).mockReset().mockResolvedValue({ id: 'new' });
  vi.mocked(patchJson).mockReset().mockResolvedValue({});
  vi.mocked(deleteJson).mockReset().mockResolvedValue({ ok: true });
});

describe('OrderAssetsPanel', () => {
  it('shows an empty state when nothing is linked', async () => {
    renderPanel();

    expect(await screen.findByText(/no design or font files linked yet/i)).toBeInTheDocument();
  });

  it('lists files as links, with the garment scope', async () => {
    vi.mocked(getJson).mockResolvedValue([
      asset({ notes: 'outlines only' }),
      asset({
        id: 'a2',
        kind: 'font',
        name: 'Club font',
        garmentId: 'g1',
        garment: { id: 'g1', name: 'Home Jersey' },
      }),
    ]);
    renderPanel();

    const link = await screen.findByRole('link', { name: /Front print AI/ });
    expect(link).toHaveAttribute('href', 'https://drive.example/abc');
    // External links must not leak the referrer or expose window.opener.
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText('outlines only')).toBeInTheDocument();
    expect(screen.getByText('Whole order')).toBeInTheDocument();
    expect(screen.getByText('Home Jersey')).toBeInTheDocument();
    expect(screen.getByText('Font')).toBeInTheDocument();
  });

  it('adds a file with the entered values', async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText(/no design or font files linked yet/i);

    await user.click(screen.getByRole('button', { name: /add file/i }));
    await user.type(screen.getByPlaceholderText(/Front print/i), 'Back print');
    await user.type(
      screen.getByPlaceholderText('https://drive.google.com/…'),
      'https://drive.example/xyz',
    );
    await user.click(screen.getByRole('button', { name: 'Add file' }));

    expect(postJson).toHaveBeenCalledWith(
      '/api/admin/orders/order-1/assets',
      expect.objectContaining({
        kind: 'design',
        name: 'Back print',
        url: 'https://drive.example/xyz',
        garmentId: null,
        includeOnPo: false,
      }),
      expect.any(String),
    );
  });

  it('rejects a link that is not a URL before sending anything', async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText(/no design or font files linked yet/i);

    await user.click(screen.getByRole('button', { name: /add file/i }));
    await user.type(screen.getByPlaceholderText(/Front print/i), 'Bad link');
    await user.type(screen.getByPlaceholderText('https://drive.google.com/…'), 'not-a-url');
    await user.click(screen.getByRole('button', { name: 'Add file' }));

    expect(await screen.findByText(/Enter a full URL/i)).toBeInTheDocument();
    expect(postJson).not.toHaveBeenCalled();
  });

  // The supplier flag is the field staff flip most, so it's inline on the row.
  it('toggles the supplier flag inline', async () => {
    const user = userEvent.setup();
    vi.mocked(getJson).mockResolvedValue([asset()]);
    renderPanel();

    await user.click(await screen.findByLabelText('Send Front print AI to supplier'));

    expect(patchJson).toHaveBeenCalledWith(
      '/api/admin/orders/order-1/assets/a1',
      { includeOnPo: true },
      expect.any(String),
    );
  });

  it('removes a file after confirmation', async () => {
    const user = userEvent.setup();
    vi.mocked(getJson).mockResolvedValue([asset()]);
    renderPanel();

    await user.click(await screen.findByLabelText('Remove Front print AI'));
    await user.click(await screen.findByRole('button', { name: 'Remove' }));

    expect(deleteJson).toHaveBeenCalledWith(
      '/api/admin/orders/order-1/assets/a1',
      undefined,
      expect.any(String),
    );
  });

  it('pre-fills the form when editing', async () => {
    const user = userEvent.setup();
    vi.mocked(getJson).mockResolvedValue([
      asset({ name: 'Front print AI', notes: 'outlines only', includeOnPo: true }),
    ]);
    renderPanel();

    await user.click(await screen.findByLabelText('Edit Front print AI'));

    expect(screen.getByDisplayValue('Front print AI')).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://drive.example/abc')).toBeInTheDocument();
    expect(screen.getByDisplayValue('outlines only')).toBeInTheDocument();
  });

  it('surfaces a load failure instead of an empty state', async () => {
    vi.mocked(getJson).mockRejectedValue(new Error('nope'));
    renderPanel();

    expect(await screen.findByText('Failed to load design files')).toBeInTheDocument();
  });
});
