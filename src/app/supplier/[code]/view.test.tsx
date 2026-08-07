/**
 * The supplier portal's PO table. Covered here: the awaiting-approval BADGE
 * (David, 2026-08-06) — the factory has to be able to see which of its jobs are
 * parked with us without opening each one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App as AntdApp } from 'antd';
import { installMockFetch, type MockRoute } from '@/test/mockFetch';
import { SupplierPortalHomeView } from './view';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('next/image', () => ({
  default: ({ alt }: { alt: string }) => <span>{alt}</span>,
}));

const CODE = 'DY';

function row(overrides: Record<string, unknown> = {}) {
  return {
    poId: 'po-1',
    poNumber: 'PO-2608-DY01',
    status: 'test_print',
    allowedNextStatuses: [],
    expectedShipDate: null,
    actualShipDate: null,
    sentAt: null,
    revisionNumber: 1,
    awaitingApprovalAt: null,
    garmentNames: ['Team Hoodie'],
    totalUnits: 12,
    ...overrides,
  };
}

function posRoute(items: ReturnType<typeof row>[]): MockRoute {
  return {
    match: `/api/supplier/${CODE}/pos`,
    method: 'GET',
    response: { items, supplierName: 'Dynasty', name: 'Ana' },
  };
}

function renderView() {
  return render(
    <AntdApp>
      <SupplierPortalHomeView code={CODE} />
    </AntdApp>,
  );
}

beforeEach(() => {
  installMockFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SupplierPortalHomeView — awaiting approval', () => {
  it('badges a submitted row alongside its status, which has NOT moved', async () => {
    installMockFetch([
      posRoute([row({ awaitingApprovalAt: '2026-08-06T09:00:00Z' })]),
    ]);
    renderView();

    expect(await screen.findByText('PO-2608-DY01')).toBeInTheDocument();
    expect(screen.getByText('Awaiting approval')).toBeInTheDocument();
    // The phase label is still there — submitting does not change the status.
    expect(screen.getByText('Test print')).toBeInTheDocument();
  });

  it('badges only the rows that are waiting', async () => {
    installMockFetch([
      posRoute([
        row(),
        row({ poId: 'po-2', poNumber: 'PO-2608-DY02', awaitingApprovalAt: '2026-08-06T09:00:00Z' }),
      ]),
    ]);
    renderView();

    await screen.findByText('PO-2608-DY01');
    expect(screen.getAllByText('Awaiting approval')).toHaveLength(1);
  });

  it('shows no badge when nothing has been submitted', async () => {
    installMockFetch([posRoute([row()])]);
    renderView();

    await screen.findByText('PO-2608-DY01');
    expect(screen.queryByText('Awaiting approval')).not.toBeInTheDocument();
  });
});
