import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { getRosterForMemberByMemberToken } from '@/server/roster/customer-service';
import { getSignedUrl } from '@/lib/storage';
import CustomerRosterMemberPage from './page';

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/server/roster/customer-service', () => ({
  getRosterForMemberByMemberToken: vi.fn(),
}));

vi.mock('@/lib/storage', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://signed.example.com/asset'),
}));

vi.mock('./view', () => ({
  RosterMemberView: (props: unknown) => <div data-testid="roster-member-view">{JSON.stringify(props)}</div>,
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
    member: {
      id: 'member-1',
      name: 'Alex Player',
      playerNumber: '7',
      submittedAt: new Date('2026-01-10T00:00:00Z'),
      sizes: [{ garmentId: 'garment-1', size: 'M' }],
    },
    ...overrides,
  };
}

type RosterForMemberByTokenResult = Awaited<ReturnType<typeof getRosterForMemberByMemberToken>>;

function mockRosterResult(roster: Record<string, unknown>): RosterForMemberByTokenResult {
  return roster as unknown as RosterForMemberByTokenResult;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSignedUrl).mockResolvedValue('https://signed.example.com/asset');
});

async function renderPage(memberToken = 'raw-member-token') {
  const element = await CustomerRosterMemberPage({ params: Promise.resolve({ memberToken }) });
  return render(element);
}

describe('CustomerRosterMemberPage', () => {
  it('renders the generic not-found page when the token has no matching member', async () => {
    vi.mocked(getRosterForMemberByMemberToken).mockResolvedValueOnce(null);

    await expect(
      CustomerRosterMemberPage({ params: Promise.resolve({ memberToken: 'bad-token' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('signs size-chart URLs and passes order/member data through to the view', async () => {
    vi.mocked(getRosterForMemberByMemberToken).mockResolvedValueOnce(mockRosterResult(baseRoster()));

    await renderPage();

    const props = JSON.parse(screen.getByTestId('roster-member-view').textContent!);
    expect(props.memberToken).toBe('raw-member-token');
    expect(props.roster.orderNumber).toBe('OC-1');
    expect(props.roster.clubName).toBe('Wildcats');
    expect(props.roster.locked).toBe(false);
    expect(props.roster.member.name).toBe('Alex Player');
    expect(props.roster.member.submittedAt).toBe('2026-01-10T00:00:00.000Z');

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
  });

  it('leaves a member with no submission as null instead of throwing', async () => {
    vi.mocked(getRosterForMemberByMemberToken).mockResolvedValueOnce(
      mockRosterResult(
        baseRoster({
          member: { id: 'member-1', name: 'Alex Player', playerNumber: '7', submittedAt: null, sizes: [] },
        }),
      ),
    );

    await renderPage();

    const props = JSON.parse(screen.getByTestId('roster-member-view').textContent!);
    expect(props.roster.member.submittedAt).toBeNull();
  });

  it('leaves size-chart URLs null instead of throwing when storage is not configured', async () => {
    vi.mocked(getRosterForMemberByMemberToken).mockResolvedValueOnce(mockRosterResult(baseRoster()));
    vi.mocked(getSignedUrl).mockRejectedValue(new Error('storage not configured'));

    await renderPage();

    const props = JSON.parse(screen.getByTestId('roster-member-view').textContent!);
    const chart = props.roster.garments[0].sizeCharts[0];
    expect(chart.url).toBeNull();
    expect(chart.downloadUrl).toBeNull();
  });

  it('leaves size-chart URLs null for a garment with no storage key, without calling getSignedUrl', async () => {
    vi.mocked(getRosterForMemberByMemberToken).mockResolvedValueOnce(
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

    const props = JSON.parse(screen.getByTestId('roster-member-view').textContent!);
    const chart = props.roster.garments[0].sizeCharts[0];
    expect(chart.url).toBeNull();
    expect(chart.downloadUrl).toBeNull();
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it('passes the locked flag through to the view', async () => {
    vi.mocked(getRosterForMemberByMemberToken).mockResolvedValueOnce(
      mockRosterResult(
        baseRoster({
          order: {
            id: 'order-1',
            orderNumber: 'OC-1',
            clubName: null,
            locked: true,
            garments: [],
          },
        }),
      ),
    );

    await renderPage();

    const props = JSON.parse(screen.getByTestId('roster-member-view').textContent!);
    expect(props.roster.locked).toBe(true);
    expect(props.roster.clubName).toBeNull();
  });
});
