import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import { InboxBell, type InboxItem } from './InboxBell';

vi.mock('@/lib/api-fetch', () => ({
  getJson: vi.fn(),
  postJson: vi.fn(),
  patchJson: vi.fn(),
  deleteJson: vi.fn(),
  ApiError: class ApiError extends Error {},
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    onClick,
  }: {
    href: string;
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <a href={href} onClick={onClick}>
      {children}
    </a>
  ),
}));

import { getJson, postJson } from '@/lib/api-fetch';

function item(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: 'i1',
    eventKey: 'workflow.stage_entered',
    title: 'Work has reached Artwork',
    body: 'A job has moved into a stage you own.',
    href: '/admin/orders/o1?tab=checklist',
    entityType: 'order',
    entityId: 'o1',
    readAt: null,
    createdAt: '2026-07-20T09:00:00Z',
    ...overrides,
  };
}

function respond(items: InboxItem[], unreadCount = items.filter((i) => !i.readAt).length) {
  return { items, unreadCount };
}

function renderBell() {
  return render(
    <AntdApp>
      <InboxBell />
    </AntdApp>,
  );
}

beforeEach(() => {
  vi.mocked(getJson).mockReset().mockResolvedValue(respond([]));
  vi.mocked(postJson).mockReset().mockResolvedValue({ marked: 0, unreadCount: 0 });
});

describe('InboxBell', () => {
  it('loads the inbox on mount', async () => {
    renderBell();

    await waitFor(() => expect(getJson).toHaveBeenCalledWith('/api/admin/inbox', expect.any(String)));
  });

  it('announces the unread count in the button label', async () => {
    vi.mocked(getJson).mockResolvedValue(respond([item(), item({ id: 'i2' })]));
    renderBell();

    expect(
      await screen.findByRole('button', { name: 'Notifications (2 unread)' }),
    ).toBeInTheDocument();
  });

  it('drops the count from the label when nothing is unread', async () => {
    renderBell();

    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeInTheDocument();
  });

  it('shows an empty state in the drawer', async () => {
    const user = userEvent.setup();
    renderBell();

    await user.click(await screen.findByRole('button', { name: 'Notifications' }));

    expect(await screen.findByText(/nothing to catch up on/i)).toBeInTheDocument();
  });

  it('lists items with a link to the thing they are about', async () => {
    const user = userEvent.setup();
    vi.mocked(getJson).mockResolvedValue(respond([item()]));
    renderBell();

    await user.click(await screen.findByRole('button', { name: /notifications/i }));

    const link = await screen.findByRole('link', { name: 'Work has reached Artwork' });
    expect(link).toHaveAttribute('href', '/admin/orders/o1?tab=checklist');
    expect(screen.getByText(/a job has moved into a stage you own/i)).toBeInTheDocument();
  });

  it('marks everything read', async () => {
    const user = userEvent.setup();
    vi.mocked(getJson).mockResolvedValue(respond([item()]));
    renderBell();

    await user.click(await screen.findByRole('button', { name: /notifications/i }));
    await user.click(await screen.findByRole('button', { name: /mark all read/i }));

    expect(postJson).toHaveBeenCalledWith('/api/admin/inbox', {}, expect.any(String));
  });

  it('offers no mark-all button when nothing is unread', async () => {
    const user = userEvent.setup();
    vi.mocked(getJson).mockResolvedValue(respond([item({ readAt: '2026-07-20T10:00:00Z' })], 0));
    renderBell();

    await user.click(await screen.findByRole('button', { name: 'Notifications' }));

    await screen.findByRole('link', { name: 'Work has reached Artwork' });
    expect(screen.queryByRole('button', { name: /mark all read/i })).not.toBeInTheDocument();
  });

  it('marks a single item read when it is opened', async () => {
    const user = userEvent.setup();
    vi.mocked(getJson).mockResolvedValue(respond([item()]));
    renderBell();

    await user.click(await screen.findByRole('button', { name: /notifications/i }));
    await user.click(await screen.findByRole('link', { name: 'Work has reached Artwork' }));

    expect(postJson).toHaveBeenCalledWith(
      '/api/admin/inbox',
      { itemIds: ['i1'] },
      expect.any(String),
    );
  });

  it('does not re-mark an item that is already read', async () => {
    const user = userEvent.setup();
    vi.mocked(getJson).mockResolvedValue(respond([item({ readAt: '2026-07-20T10:00:00Z' })], 0));
    renderBell();

    await user.click(await screen.findByRole('button', { name: 'Notifications' }));
    await user.click(await screen.findByRole('link', { name: 'Work has reached Artwork' }));

    expect(postJson).not.toHaveBeenCalled();
  });

  // A failing poll every minute must not turn into a toast every minute.
  it('stays quiet when a poll fails', async () => {
    vi.mocked(getJson).mockRejectedValue(new Error('inbox is down'));
    renderBell();

    await waitFor(() => expect(getJson).toHaveBeenCalled());
    expect(screen.queryByText('inbox is down')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeInTheDocument();
  });

  it('renders an item with no link as plain text', async () => {
    const user = userEvent.setup();
    vi.mocked(getJson).mockResolvedValue(respond([item({ href: null })]));
    renderBell();

    await user.click(await screen.findByRole('button', { name: /notifications/i }));

    await screen.findByText('Work has reached Artwork');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
