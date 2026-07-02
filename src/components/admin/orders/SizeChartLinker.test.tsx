import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import { SizeChartLinker } from './SizeChartLinker';

function renderLinker(props: Partial<React.ComponentProps<typeof SizeChartLinker>> = {}) {
  return render(
    <AntdApp>
      <SizeChartLinker orderId="order-1" garmentId="garment-1" initialIds={[]} {...props} />
    </AntdApp>,
  );
}

const CHARTS = [
  { id: 'chart-1', name: 'Adult Unisex', description: null },
  { id: 'chart-2', name: 'Youth Unisex', description: null },
];

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

describe('SizeChartLinker', () => {
  it('fetches the chart library on mount and shows options', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => CHARTS } as Response);
    renderLinker();

    expect(fetch).toHaveBeenCalledWith('/api/admin/size-charts');
    await screen.findByRole('combobox');

    await userEvent.setup().click(screen.getByRole('combobox'));
    expect(await screen.findByText('Adult Unisex')).toBeInTheDocument();
    expect(screen.getByText('Youth Unisex')).toBeInTheDocument();
  });

  it('shows an empty-library message with a link when there are no charts', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => [] } as Response);
    renderLinker();

    expect(await screen.findByText(/no size charts in library yet/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /add charts/i })).toHaveAttribute('href', '/admin/size-charts');
  });

  it('pre-selects initialIds once charts have loaded', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => CHARTS } as Response);
    renderLinker({ initialIds: ['chart-1'] });
    await screen.findByRole('combobox');

    await user.click(screen.getByRole('combobox'));

    expect(await screen.findByRole('option', { name: 'Adult Unisex' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: 'Youth Unisex' })).toHaveAttribute('aria-selected', 'false');
  });

  it('selecting a chart PATCHes the garment with the new sizeChartIds', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => CHARTS } as Response);
    renderLinker();
    await screen.findByRole('combobox');

    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) } as Response);
    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByText('Adult Unisex'));

    expect(fetch).toHaveBeenLastCalledWith('/api/admin/orders/order-1/garments/garment-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sizeChartIds: ['chart-1'] }),
    });
  });

  it('shows an error message when saving the link fails', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => CHARTS } as Response);
    renderLinker();
    await screen.findByRole('combobox');

    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, json: async () => ({}) } as Response);
    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByText('Adult Unisex'));

    expect(await screen.findByText(/failed to save size chart links/i)).toBeInTheDocument();
  });
});
