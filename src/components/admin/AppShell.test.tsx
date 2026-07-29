import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppShell } from './AppShell';

vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/orders',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn());
});

describe('AppShell nav', () => {
  it('shows Home, Metrics, Orders, and Size Charts for a sales-role user, but not Users', async () => {
    render(
      <AppShell user={{ name: 'Sales Rep', email: 'sales@example.com', role: 'sales' }}>
        <div>content</div>
      </AppShell>,
    );

    expect(await screen.findByRole('menuitem', { name: /home/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /metrics/i })).toBeInTheDocument();
    // The icon's aria-label is part of the accessible name, so distinguish
    // "Orders" from "Purchase Orders" with a matcher function.
    expect(
      screen.getByRole('menuitem', { name: (n) => /orders/i.test(n) && !/purchase/i.test(n) }),
    ).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /purchase orders/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /shipments/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /suppliers/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /size charts/i })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /users/i })).not.toBeInTheDocument();
  });

  it('shows the Users nav item for an admin-role user', async () => {
    render(
      <AppShell user={{ name: 'Admin', email: 'admin@example.com', role: 'admin' }}>
        <div>content</div>
      </AppShell>,
    );

    expect(await screen.findByRole('menuitem', { name: /users/i })).toBeInTheDocument();
  });

  it('renders the page content passed as children', async () => {
    render(
      <AppShell user={{ name: 'Sales Rep', email: 'sales@example.com', role: 'sales' }}>
        <div>Order list goes here</div>
      </AppShell>,
    );

    expect(await screen.findByText('Order list goes here')).toBeInTheDocument();
  });

  it('collapsing the sidebar switches the trigger icon; brand stays in the header', async () => {
    const user = userEvent.setup();
    render(
      <AppShell user={{ name: 'Sales Rep', email: 'sales@example.com', role: 'sales' }}>
        <div>content</div>
      </AppShell>,
    );
    await screen.findByRole('menuitem', { name: /home/i });

    expect(screen.getByText('BeastMode')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'menu-fold' }));

    // Brand lives in the fixed header now — collapsing the sider keeps it visible.
    expect(screen.getByText('BeastMode')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'menu-unfold' })).toBeInTheDocument();
  });

  it('toggling the theme persists the choice to localStorage', async () => {
    const user = userEvent.setup();
    render(
      <AppShell user={{ name: 'Sales Rep', email: 'sales@example.com', role: 'sales' }}>
        <div>content</div>
      </AppShell>,
    );
    await screen.findByRole('menuitem', { name: /home/i });

    await user.click(screen.getByRole('button', { name: 'moon' }));

    expect(localStorage.getItem('bm-admin-theme')).toBe('dark');
    expect(screen.getByRole('button', { name: 'sun' })).toBeInTheDocument();
  });
});
