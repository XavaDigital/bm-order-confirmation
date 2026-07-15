import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { getRosterForMember } from '@/server/roster/customer-service';
import { getSignedUrl } from '@/lib/storage';
import CustomerRosterPage from './page';

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/server/roster/customer-service', () => ({
  getRosterForMember: vi.fn(),
}));

vi.mock('@/lib/storage', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://signed.example.com/asset'),
}));

vi.mock('./view', () => ({
  RosterCustomerView: (props: unknown) => <div data-testid="roster-view">{JSON.stringify(props)}</div>,
}));

function baseRoster(overrides: Record<string, unknown> = {}) {
  return {
    order: {
      id: 'order-1',
      orderNumber: 'OC-1',
      clubName: 'Wildcats',
      locked: false,
      garments: [
        {
          id: 'garment-1',
          name: 'Home Jersey',
          notes: null,
          sizeCharts: [{ name: 'Adult Sizing', storageKey: 'charts/adult.pdf' }],
        },
      ],
    },
    members: [
      {
        id: 'member-1',
        name: 'Alex Player',
        playerNumber: '7',
        submittedAt: new Date('2026-01-10T00:00:00Z'),
        sizes: [{ garmentId: 'garment-1', size: 'M' }],
      },
    ],
    ...overrides,
  };
}

type RosterForMemberResult = Awaited<ReturnType<typeof getRosterForMember>>;

function mockRosterResult(roster: Record<string, unknown>): RosterForMemberResult {
  return roster as unknown as RosterForMemberResult;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSignedUrl).mockResolvedValue('https://signed.example.com/asset');
});

async function renderPage(rosterToken = 'raw-roster-token') {
  const element = await CustomerRosterPage({ params: Promise.resolve({ rosterToken }) });
  return render(element);
}

describe('CustomerRosterPage', () => {
  it('renders the generic not-found page when the token has no matching roster', async () => {
    vi.mocked(getRosterForMember).mockResolvedValueOnce(null);

    await expect(
      CustomerRosterPage({ params: Promise.resolve({ rosterToken: 'bad-token' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('signs size-chart URLs and passes order/member data through to the view', async () => {
    vi.mocked(getRosterForMember).mockResolvedValueOnce(mockRosterResult(baseRoster()));

    await renderPage();

    const props = JSON.parse(screen.getByTestId('roster-view').textContent!);
    expect(props.rosterToken).toBe('raw-roster-token');
    expect(props.roster.orderNumber).toBe('OC-1');
    expect(props.roster.clubName).toBe('Wildcats');
    expect(props.roster.locked).toBe(false);

    const chart = props.roster.garments[0].sizeCharts[0];
    expect(chart).toEqual({
      name: 'Adult Sizing',
      storageKey: 'charts/adult.pdf',
      url: 'https://signed.example.com/asset',
      downloadUrl: 'https://signed.example.com/asset',
    });
    expect(getSignedUrl).toHaveBeenCalledWith('charts/adult.pdf', 3600);
    expect(getSignedUrl).toHaveBeenCalledWith('charts/adult.pdf', 3600, {
      contentDisposition: 'attachment; filename="adult.pdf"',
    });

    // Member submittedAt is serialized to an ISO string for the client component.
    expect(props.roster.members[0].submittedAt).toBe('2026-01-10T00:00:00.000Z');
  });

  it('leaves a member with no submission as null instead of throwing', async () => {
    vi.mocked(getRosterForMember).mockResolvedValueOnce(
      mockRosterResult(
        baseRoster({
          members: [
            { id: 'member-2', name: 'Sam Coach', playerNumber: null, submittedAt: null, sizes: [] },
          ],
        }),
      ),
    );

    await renderPage();

    const props = JSON.parse(screen.getByTestId('roster-view').textContent!);
    expect(props.roster.members[0].submittedAt).toBeNull();
  });

  it('leaves size-chart URLs null instead of throwing when storage is not configured', async () => {
    vi.mocked(getRosterForMember).mockResolvedValueOnce(mockRosterResult(baseRoster()));
    vi.mocked(getSignedUrl).mockRejectedValue(new Error('storage not configured'));

    await renderPage();

    const props = JSON.parse(screen.getByTestId('roster-view').textContent!);
    const chart = props.roster.garments[0].sizeCharts[0];
    expect(chart.url).toBeNull();
    expect(chart.downloadUrl).toBeNull();
  });

  it('leaves size-chart URLs null for a garment with no storage key, without calling getSignedUrl', async () => {
    vi.mocked(getRosterForMember).mockResolvedValueOnce(
      mockRosterResult(
        baseRoster({
          order: {
            id: 'order-1',
            orderNumber: 'OC-1',
            clubName: 'Wildcats',
            locked: false,
            garments: [
              {
                id: 'garment-1',
                name: 'Home Jersey',
                notes: null,
                sizeCharts: [{ name: 'Unavailable Chart', storageKey: null }],
              },
            ],
          },
        }),
      ),
    );

    await renderPage();

    const props = JSON.parse(screen.getByTestId('roster-view').textContent!);
    const chart = props.roster.garments[0].sizeCharts[0];
    expect(chart.url).toBeNull();
    expect(chart.downloadUrl).toBeNull();
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it('passes the locked flag and multiple members through to the view', async () => {
    vi.mocked(getRosterForMember).mockResolvedValueOnce(
      mockRosterResult(
        baseRoster({
          order: {
            id: 'order-1',
            orderNumber: 'OC-1',
            clubName: null,
            locked: true,
            garments: [],
          },
          members: [
            { id: 'm1', name: 'Alex', playerNumber: null, submittedAt: null, sizes: [] },
            { id: 'm2', name: 'Sam', playerNumber: null, submittedAt: null, sizes: [] },
          ],
        }),
      ),
    );

    await renderPage();

    const props = JSON.parse(screen.getByTestId('roster-view').textContent!);
    expect(props.roster.locked).toBe(true);
    expect(props.roster.clubName).toBeNull();
    expect(props.roster.members).toHaveLength(2);
  });
});
