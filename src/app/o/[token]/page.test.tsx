import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { getOrderForCustomer, recordOrderViewed } from '@/server/orders/customer-service';
import { getSignedUrl } from '@/lib/storage';
import { isAccessCodeCookieValid } from '@/lib/access-code';
import CustomerOrderPage from './page';

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

const cookiesGetMock = vi.fn();
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => Promise.resolve({ get: cookiesGetMock })),
}));

vi.mock('@/server/orders/customer-service', () => ({
  getOrderForCustomer: vi.fn(),
  recordOrderViewed: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/storage', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://signed.example.com/asset'),
}));

vi.mock('@/lib/access-code', () => ({
  ACCESS_CODE_COOKIE: 'bm-oc-verified',
  isAccessCodeCookieValid: vi.fn(() => true),
}));

vi.mock('@/components/customer/AccessCodeGate', () => ({
  AccessCodeGate: ({ token }: { token: string }) => <div data-testid="access-code-gate">{token}</div>,
}));

vi.mock('./view', () => ({
  CustomerOrderView: (props: unknown) => <div data-testid="order-view">{JSON.stringify(props)}</div>,
}));

function baseOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    orderNumber: 'OC-1',
    customerName: 'Jane Coach',
    customerEmail: 'jane@example.com',
    clubName: null,
    status: 'sent',
    orderValueAmount: null,
    orderValueCurrency: null,
    invoiceUrl: null,
    expectedShipDate: null,
    deadlineDate: null,
    generalNotes: null,
    shippingMode: 'later' as const,
    shippingAddress: null,
    rosterSummary: { total: 0, submitted: 0, pending: 0 },
    garments: [
      {
        id: 'garment-1',
        name: 'Home Jersey',
        fabrics: ['Polyester'],
        notes: null,
        sizing: [{ size: 'M', playerName: null, playerNumber: null, notes: null, rosterMemberId: null }],
        images: [{ id: 'img-1', storageKey: 'orders/1/mockup.png', caption: null, sortOrder: 0 }],
        sizeChartLinks: [
          { sizeChart: { name: 'Adult Sizing', storageKey: 'charts/adult.pdf' } },
          { sizeChart: null },
        ],
      },
    ],
    ...overrides,
  };
}

function baseAccess(overrides: Record<string, unknown> = {}) {
  return { id: 'access-1', accessCodeHash: null, expiresAt: null, revokedAt: null, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(recordOrderViewed).mockResolvedValue(undefined);
  vi.mocked(getSignedUrl).mockResolvedValue('https://signed.example.com/asset');
  vi.mocked(isAccessCodeCookieValid).mockReturnValue(true);
});

async function renderPage(token = 'raw-token') {
  const element = await CustomerOrderPage({ params: Promise.resolve({ token }) });
  return render(element);
}

type OrderForCustomerResult = Awaited<ReturnType<typeof getOrderForCustomer>>;

// The real Drizzle query result carries many more columns/relations than this
// page reads; test fixtures only need the fields page.tsx actually touches.
function mockOrderResult(
  order: Record<string, unknown>,
  access: Record<string, unknown>,
): OrderForCustomerResult {
  return { order, access } as unknown as OrderForCustomerResult;
}

describe('CustomerOrderPage', () => {
  it('renders the generic not-found page when the token has no matching access row', async () => {
    vi.mocked(getOrderForCustomer).mockResolvedValueOnce(null);

    await expect(CustomerOrderPage({ params: Promise.resolve({ token: 'bad-token' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
  });

  it('shows the AccessCodeGate instead of the order when a code is required and no valid cookie is present', async () => {
    vi.mocked(getOrderForCustomer).mockResolvedValueOnce(
      mockOrderResult(baseOrder(), baseAccess({ accessCodeHash: 'bcrypt-hash' })),
    );
    cookiesGetMock.mockReturnValue(undefined);
    vi.mocked(isAccessCodeCookieValid).mockReturnValue(false);

    await renderPage();

    expect(screen.getByTestId('access-code-gate')).toHaveTextContent('raw-token');
    expect(screen.queryByTestId('order-view')).not.toBeInTheDocument();
    expect(recordOrderViewed).not.toHaveBeenCalled();
  });

  it('renders the order when the access-code cookie is valid, and records the view', async () => {
    vi.mocked(getOrderForCustomer).mockResolvedValueOnce(
      mockOrderResult(baseOrder({ status: 'sent' }), baseAccess({ accessCodeHash: 'bcrypt-hash' })),
    );
    cookiesGetMock.mockReturnValue({ value: 'signed-cookie-value' });
    vi.mocked(isAccessCodeCookieValid).mockReturnValue(true);

    await renderPage();

    expect(screen.getByTestId('order-view')).toBeInTheDocument();
    expect(screen.queryByTestId('access-code-gate')).not.toBeInTheDocument();
    expect(recordOrderViewed).toHaveBeenCalledWith('order-1', 'access-1', 'sent');
  });

  it('skips the cookie check entirely when the order has no access code configured', async () => {
    vi.mocked(getOrderForCustomer).mockResolvedValueOnce(
      mockOrderResult(baseOrder(), baseAccess({ accessCodeHash: null })),
    );

    await renderPage();

    expect(screen.getByTestId('order-view')).toBeInTheDocument();
    expect(cookiesGetMock).not.toHaveBeenCalled();
  });

  it('signs garment image and size-chart URLs, filters out unlinked size charts, and defaults missing fields', async () => {
    vi.mocked(getOrderForCustomer).mockResolvedValueOnce(mockOrderResult(baseOrder(), baseAccess()));

    await renderPage();

    const props = JSON.parse(screen.getByTestId('order-view').textContent!);
    expect(props.order.orderValueCurrency).toBe('NZD');
    expect(props.order.clubName).toBeNull();
    expect(props.order.garments).toHaveLength(1);

    const garment = props.order.garments[0];
    expect(garment.images).toEqual([{ id: 'img-1', caption: null, url: 'https://signed.example.com/asset' }]);
    expect(garment.sizeCharts).toHaveLength(1); // the null sizeChart link was filtered out
    expect(garment.sizing[0].viaTeamRoster).toBe(false);
    expect(garment.sizeCharts[0]).toEqual({
      name: 'Adult Sizing',
      storageKey: 'charts/adult.pdf',
      url: 'https://signed.example.com/asset',
      downloadUrl: 'https://signed.example.com/asset',
    });
    expect(getSignedUrl).toHaveBeenCalledWith('orders/1/mockup.png', 3600);
    expect(getSignedUrl).toHaveBeenCalledWith('charts/adult.pdf', 3600, {
      contentDisposition: 'attachment; filename="adult.pdf"',
    });
  });

  it('passes roster progress through to the customer view', async () => {
    vi.mocked(getOrderForCustomer).mockResolvedValueOnce(
      mockOrderResult(
        baseOrder({
          rosterSummary: { total: 5, submitted: 3, pending: 2 },
        }),
        baseAccess(),
      ),
    );

    await renderPage();

    const props = JSON.parse(screen.getByTestId('order-view').textContent!);
    expect(props.order.rosterSummary).toEqual({ total: 5, submitted: 3, pending: 2 });
  });

  it('logs but does not throw when the fire-and-forget view-tracking call fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getOrderForCustomer).mockResolvedValueOnce(mockOrderResult(baseOrder(), baseAccess()));
    vi.mocked(recordOrderViewed).mockRejectedValueOnce(new Error('db down'));

    await renderPage();

    expect(screen.getByTestId('order-view')).toBeInTheDocument();
    await vi.waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith('[page.tsx] recordOrderViewed failed', expect.any(Error)),
    );
    consoleError.mockRestore();
  });

  it('leaves image and size-chart URLs empty/null instead of throwing when storage is not configured', async () => {
    vi.mocked(getOrderForCustomer).mockResolvedValueOnce(mockOrderResult(baseOrder(), baseAccess()));
    vi.mocked(getSignedUrl).mockRejectedValue(new Error('storage not configured'));

    await renderPage();

    const props = JSON.parse(screen.getByTestId('order-view').textContent!);
    const garment = props.order.garments[0];
    expect(garment.images[0].url).toBe('');
    expect(garment.sizeCharts[0].url).toBeNull();
    expect(garment.sizeCharts[0].downloadUrl).toBeNull();
  });
});
