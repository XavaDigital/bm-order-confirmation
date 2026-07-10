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
  it('shows Dashboard, Orders, and Size Charts for a sales-role user, but not Users', async () => {
    render(
      <AppShell user={{ name: 'Sales Rep', email: 'sales@example.com', role: 'sales' }}>
        <div>content</div>
      </AppShell>,
    );

    expect(await screen.findByRole('menuitem', { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /orders/i })).toBeInTheDocument();
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

  it('collapsing the sidebar hides the logo text and switches the trigger icon', async () => {
    const user = userEvent.setup();
    render(
      <AppShell user={{ name: 'Sales Rep', email: 'sales@example.com', role: 'sales' }}>
        <div>content</div>
      </AppShell>,
    );
    await screen.findByRole('menuitem', { name: /dashboard/i });

    expect(screen.getByText('BeastMode')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'menu-fold' }));

    expect(screen.queryByText('BeastMode')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'menu-unfold' })).toBeInTheDocument();
  });

  it('toggling the theme persists the choice to localStorage', async () => {
    const user = userEvent.setup();
    render(
      <AppShell user={{ name: 'Sales Rep', email: 'sales@example.com', role: 'sales' }}>
        <div>content</div>
      </AppShell>,
    );
    await screen.findByRole('menuitem', { name: /dashboard/i });

    await user.click(screen.getByRole('button', { name: 'moon' }));

    expect(localStorage.getItem('bm-admin-theme')).toBe('dark');
    expect(screen.getByRole('button', { name: 'sun' })).toBeInTheDocument();
  });
});
