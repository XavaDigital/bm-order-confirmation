import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import { ConditionalReminders } from './ConditionalReminders';

vi.mock('@/lib/api-fetch', () => ({
  getJson: vi.fn(),
  postJson: vi.fn(),
  putJson: vi.fn(),
  patchJson: vi.fn(),
  deleteJson: vi.fn(),
  ApiError: class ApiError extends Error {},
}));

import { deleteJson, getJson, postJson } from '@/lib/api-fetch';

function renderPanel(props: Partial<React.ComponentProps<typeof ConditionalReminders>> = {}) {
  return render(
    <AntdApp>
      <ConditionalReminders boardKey="order" entityId="o1" {...props} />
    </AntdApp>,
  );
}

beforeEach(() => {
  vi.mocked(getJson).mockReset().mockResolvedValue([]);
  vi.mocked(postJson).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(deleteJson).mockReset().mockResolvedValue({ ok: true });
});

describe('ConditionalReminders', () => {
  it('shows an empty state with no reminders', async () => {
    renderPanel();

    expect(await screen.findByText(/no conditional reminders set/i)).toBeInTheDocument();
  });

  it('lists pending reminders with their trigger status', async () => {
    vi.mocked(getJson).mockResolvedValue([
      {
        id: 'r1',
        triggerStatus: 'confirmed',
        note: 'Send customer a test print for approval',
        createdByStaffUserId: 'u1',
        firedAt: null,
        resolvedAt: null,
        createdAt: '2026-08-06T00:00:00Z',
      },
    ]);

    renderPanel();

    expect(await screen.findByText('Send customer a test print for approval')).toBeInTheDocument();
    expect(screen.getByText(/when confirmed/i)).toBeInTheDocument();
  });

  it('creates a reminder with the chosen status and note', async () => {
    const user = userEvent.setup();
    renderPanel({ boardKey: 'purchase_order', entityId: 'po1' });
    await screen.findByText(/no conditional reminders set/i);

    await user.click(screen.getByRole('button', { name: /add/i }));
    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByTitle('Test print'));
    await user.type(screen.getByPlaceholderText(/send customer/i), 'Send a proof');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(postJson).toHaveBeenCalled());
    expect(postJson).toHaveBeenCalledWith(
      '/api/admin/workflow/status-reminders',
      { boardKey: 'purchase_order', entityId: 'po1', triggerStatus: 'test_print', note: 'Send a proof' },
      expect.any(String),
    );
  });

  it('cancels a pending reminder', async () => {
    vi.mocked(getJson).mockResolvedValue([
      {
        id: 'r1',
        triggerStatus: 'confirmed',
        note: 'ping',
        createdByStaffUserId: 'u1',
        firedAt: null,
        resolvedAt: null,
        createdAt: '2026-08-06T00:00:00Z',
      },
    ]);
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByLabelText(/cancel reminder: ping/i));

    await waitFor(() =>
      expect(deleteJson).toHaveBeenCalledWith(
        '/api/admin/workflow/status-reminders',
        { id: 'r1' },
        expect.any(String),
      ),
    );
  });
});
