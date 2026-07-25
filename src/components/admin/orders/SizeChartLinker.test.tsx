import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import { SizeChartLinker } from './SizeChartLinker';

const CHARTS = [
  { id: 'chart-1', name: 'Adult Unisex', description: null },
  { id: 'chart-2', name: 'Youth Unisex', description: null },
];

function renderLinker(props: Partial<React.ComponentProps<typeof SizeChartLinker>> = {}) {
  return render(
    <AntdApp>
      <SizeChartLinker
        orderId="order-1"
        garmentId="garment-1"
        value={[]}
        charts={CHARTS}
        onSaved={vi.fn()}
        {...props}
      />
    </AntdApp>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

describe('SizeChartLinker', () => {
  it('renders the parent-supplied chart library without any mount fetch', async () => {
    renderLinker();

    expect(fetch).not.toHaveBeenCalled();

    await userEvent.setup().click(screen.getByRole('combobox'));
    expect(await screen.findByText('Adult Unisex')).toBeInTheDocument();
    expect(screen.getByText('Youth Unisex')).toBeInTheDocument();
  });

  it('shows an empty-library message with a link when there are no charts', () => {
    renderLinker({ charts: [] });

    expect(screen.getByText(/no size charts in library yet/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /add charts/i })).toHaveAttribute('href', '/admin/size-charts');
  });

  it('pre-selects the value prop', async () => {
    const user = userEvent.setup();
    renderLinker({ value: ['chart-1'] });

    await user.click(screen.getByRole('combobox'));

    expect(await screen.findByRole('option', { name: 'Adult Unisex' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: 'Youth Unisex' })).toHaveAttribute('aria-selected', 'false');
  });

  it('selecting a chart PATCHes the garment and reports the ids via onSaved', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) } as Response);
    renderLinker({ onSaved });

    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByText('Adult Unisex'));

    expect(fetch).toHaveBeenLastCalledWith('/api/admin/orders/order-1/garments/garment-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sizeChartIds: ['chart-1'] }),
    });
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledWith(['chart-1']));
  });

  it('shows an error and does not call onSaved when saving fails', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, json: async () => ({}) } as Response);
    renderLinker({ onSaved });

    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByText('Adult Unisex'));

    expect(await screen.findByText(/failed to save size chart links/i)).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
