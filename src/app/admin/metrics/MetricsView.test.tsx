import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MetricsView } from './MetricsView';

function baseProps(overrides: Partial<React.ComponentProps<typeof MetricsView>> = {}) {
  return {
    counts: { draft: 0, sent: 0, viewed: 0, confirmed: 0, changesRequested: 0, cancelled: 0, total: 0 },
    totalValueNZD: 0,
    avgOrderValueNZD: 0,
    confirmationRatePct: 0,
    avgTimeToConfirmDays: null,
    trend: [],
    colorSampleHoldsCount: 0,
    role: 'sales' as const,
    failedEventsCount: 0,
    deadFailedEventsCount: 0,
    timeToConfirmBuckets: [],
    pipelineValueTrend: [],
    topClubs: [],
    poStatusCounts: [],
    garmentTypePopularity: [],
    ...overrides,
  };
}

describe('MetricsView', () => {
  it('renders the stat cards with the given counts', () => {
    render(
      <MetricsView
        {...baseProps({
          counts: { draft: 2, sent: 3, viewed: 1, confirmed: 5, changesRequested: 1, cancelled: 0, total: 12 },
        })}
      />,
    );

    expect(screen.getByText('Total Orders')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();

    // Awaiting Customer = sent (3) + viewed (1); scope the value lookup to the
    // stat card itself since plain numbers also appear in the chart axes.
    const awaitingTitle = screen.getByText('Awaiting Customer', { selector: '.ant-statistic-title' });
    const statCard = awaitingTitle.closest('.ant-statistic') as HTMLElement;
    expect(within(statCard).getByText('4')).toBeInTheDocument();
  });

  it.each([
    [500, '$500'],
    [2500, '$2.5K'],
    [1_250_000, '$1.3M'],
  ])('formats pipeline value %d as %s', (value, expected) => {
    render(<MetricsView {...baseProps({ totalValueNZD: value })} />);
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it('shows "No orders yet" in the status breakdown when every count is zero', () => {
    render(<MetricsView {...baseProps()} />);
    expect(screen.getByText('No orders yet')).toBeInTheDocument();
  });

  it('shows the colour sample holds count in its stat card', () => {
    render(<MetricsView {...baseProps({ colorSampleHoldsCount: 1 })} />);

    const statTitle = screen.getByText('Colour Sample Holds', { selector: '.ant-statistic-title' });
    const statCard = statTitle.closest('.ant-statistic') as HTMLElement;
    expect(within(statCard).getByText('1')).toBeInTheDocument();
  });

  it('hides the Failed Events stat card entirely for a sales-role session', () => {
    render(<MetricsView {...baseProps({ role: 'sales', failedEventsCount: 3 })} />);
    expect(screen.queryByText('Failed Events')).not.toBeInTheDocument();
  });

  it('shows the Failed Events stat card for an admin, with a dead-count suffix', () => {
    render(<MetricsView {...baseProps({ role: 'admin', failedEventsCount: 5, deadFailedEventsCount: 2 })} />);

    const statTitle = screen.getByText('Failed Events', { selector: '.ant-statistic-title' });
    const statCard = statTitle.closest('.ant-statistic') as HTMLElement;
    expect(within(statCard).getByText('5')).toBeInTheDocument();
    expect(screen.getByText('(2 dead)')).toBeInTheDocument();
  });

  it('renders average order value, confirmation rate, and average time to confirm', () => {
    render(
      <MetricsView
        {...baseProps({
          avgOrderValueNZD: 1250,
          confirmationRatePct: 42,
          avgTimeToConfirmDays: 3.4,
        })}
      />,
    );

    expect(screen.getByText('Average Order Value')).toBeInTheDocument();
    expect(screen.getByText('$1.3K')).toBeInTheDocument();

    const rateTitle = screen.getByText('Confirmation Rate', { selector: '.ant-statistic-title' });
    expect(within(rateTitle.closest('.ant-statistic') as HTMLElement).getByText('42')).toBeInTheDocument();

    // antd's Statistic splits a decimal value across separate int/decimal
    // spans, so match on the stat card's combined text rather than one node.
    const timeTitle = screen.getByText('Avg. Time to Confirm', { selector: '.ant-statistic-title' });
    expect((timeTitle.closest('.ant-statistic') as HTMLElement).textContent).toContain('3.4');
  });

  it('shows an em dash for average time to confirm when there are no confirmed orders', () => {
    render(<MetricsView {...baseProps({ avgTimeToConfirmDays: null })} />);

    const timeTitle = screen.getByText('Avg. Time to Confirm', { selector: '.ant-statistic-title' });
    expect(within(timeTitle.closest('.ant-statistic') as HTMLElement).getByText('—')).toBeInTheDocument();
  });

  it('shows the empty state for the pipeline value trend when there is no history', () => {
    render(<MetricsView {...baseProps({ pipelineValueTrend: [{ week: '2026-06-01', label: '6/1', valueNZD: 0 }] })} />);
    expect(screen.getByText(/no order value recorded in the last 8 weeks/i)).toBeInTheDocument();
  });

  it('shows the empty state for time to confirm when there are no confirmed orders', () => {
    render(
      <MetricsView
        {...baseProps({
          timeToConfirmBuckets: [{ bucket: '0-3 days', count: 0 }],
        })}
      />,
    );
    expect(screen.getByText(/no confirmed orders yet/i)).toBeInTheDocument();
  });

  it('renders the time to confirm chart instead of its empty state once there are confirmed orders', () => {
    // recharts renders its SVG ticks via measured layout, which jsdom doesn't
    // provide — assert the populated branch was chosen rather than reading
    // tick text out of the chart itself.
    render(
      <MetricsView
        {...baseProps({
          timeToConfirmBuckets: [
            { bucket: '0-3 days', count: 4 },
            { bucket: '4-7 days', count: 1 },
          ],
        })}
      />,
    );
    expect(screen.queryByText(/no confirmed orders yet/i)).not.toBeInTheDocument();
  });

  it('shows the empty state for Top Clubs when there are none', () => {
    render(<MetricsView {...baseProps({ topClubs: [] })} />);
    const cardTitle = screen.getByText('Top Clubs — by Order Count');
    const card = cardTitle.closest('.ant-card') as HTMLElement;
    expect(within(card).getByText('No orders to rank yet')).toBeInTheDocument();
  });

  it('renders the top clubs chart instead of its empty state once there are orders', () => {
    render(
      <MetricsView
        {...baseProps({
          topClubs: [
            { club: 'Hamilton Hawks', count: 6 },
            { club: 'Wellsford AFC', count: 2 },
          ],
        })}
      />,
    );
    expect(screen.queryByText('No orders to rank yet')).not.toBeInTheDocument();
  });

  it('shows the empty state for Purchase Order Status when there are none', () => {
    render(<MetricsView {...baseProps({ poStatusCounts: [] })} />);
    expect(screen.getByText(/no purchase orders yet/i)).toBeInTheDocument();
  });

  it('renders the purchase order status chart instead of its empty state once there are purchase orders', () => {
    render(
      <MetricsView
        {...baseProps({
          poStatusCounts: [
            { status: 'in_production', count: 3 },
            { status: 'sent', count: 1 },
          ],
        })}
      />,
    );
    expect(screen.queryByText(/no purchase orders yet/i)).not.toBeInTheDocument();
  });

  it('shows the empty state for Garment Type Popularity when there are none', () => {
    render(<MetricsView {...baseProps({ garmentTypePopularity: [] })} />);
    expect(screen.getByText(/no typed garments yet/i)).toBeInTheDocument();
  });

  it('renders the garment type popularity chart instead of its empty state once there are typed garments', () => {
    render(
      <MetricsView
        {...baseProps({
          garmentTypePopularity: [
            { name: 'Hoodie', count: 10 },
            { name: 'Polo', count: 4 },
          ],
        })}
      />,
    );
    expect(screen.queryByText(/no typed garments yet/i)).not.toBeInTheDocument();
  });
});
