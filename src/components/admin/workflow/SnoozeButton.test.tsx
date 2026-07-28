import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import { SnoozeButton } from './SnoozeButton';

vi.mock('@/lib/api-fetch', () => ({
  getJson: vi.fn(),
  postJson: vi.fn(),
  putJson: vi.fn(),
  patchJson: vi.fn(),
  deleteJson: vi.fn(),
  ApiError: class ApiError extends Error {},
}));

import { deleteJson, putJson } from '@/lib/api-fetch';

function renderButton(props: Partial<React.ComponentProps<typeof SnoozeButton>> = {}) {
  return render(
    <AntdApp>
      <SnoozeButton entityType="order" entityId="o1" {...props} />
    </AntdApp>,
  );
}

beforeEach(() => {
  vi.mocked(putJson).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(deleteJson).mockReset().mockResolvedValue({ ok: true });
});

describe('SnoozeButton', () => {
  it('offers the presets', async () => {
    const user = userEvent.setup();
    renderButton();

    await user.click(screen.getByRole('button', { name: /snooze/i }));

    expect(await screen.findByText('Tomorrow')).toBeInTheDocument();
    expect(screen.getByText('In 2 days')).toBeInTheDocument();
    expect(screen.getByText('Next week')).toBeInTheDocument();
  });

  it('sets a snooze with a future due date', async () => {
    const user = userEvent.setup();
    renderButton();

    await user.click(screen.getByRole('button', { name: /snooze/i }));
    await user.click(await screen.findByText('Tomorrow'));

    await waitFor(() => expect(putJson).toHaveBeenCalled());
    const [url, body] = vi.mocked(putJson).mock.calls[0];
    expect(url).toBe('/api/admin/workflow/reminders');
    expect(body).toMatchObject({ entityType: 'order', entityId: 'o1', kind: 'snooze' });
    expect(new Date((body as { dueAt: string }).dueAt).getTime()).toBeGreaterThan(Date.now());
  });

  // The API scopes writes to the session; the client must not be able to name
  // whose snooze it is setting.
  it('never sends a staff user id', async () => {
    const user = userEvent.setup();
    renderButton();

    await user.click(screen.getByRole('button', { name: /snooze/i }));
    await user.click(await screen.findByText('Tomorrow'));

    await waitFor(() => expect(putJson).toHaveBeenCalled());
    expect(JSON.stringify(vi.mocked(putJson).mock.calls[0][1])).not.toContain('staffUserId');
  });

  it('shows a snoozed state and clears it on click', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderButton({ snoozed: true, onChange });

    await user.click(screen.getByRole('button', { name: /snoozed/i }));

    expect(deleteJson).toHaveBeenCalledWith(
      '/api/admin/workflow/reminders',
      { entityType: 'order', entityId: 'o1', kind: 'snooze' },
      expect.any(String),
    );
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });

  it('reports the change so the caller can refresh', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderButton({ onChange });

    await user.click(screen.getByRole('button', { name: /snooze/i }));
    await user.click(await screen.findByText('Tomorrow'));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });

  it('does not report a change when the write fails', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    vi.mocked(putJson).mockRejectedValue(new Error('nope'));
    renderButton({ onChange });

    await user.click(screen.getByRole('button', { name: /snooze/i }));
    await user.click(await screen.findByText('Tomorrow'));

    await waitFor(() => expect(putJson).toHaveBeenCalled());
    expect(onChange).not.toHaveBeenCalled();
  });

  it('works for a purchase order too', async () => {
    const user = userEvent.setup();
    renderButton({ entityType: 'purchase_order', entityId: 'po1' });

    await user.click(screen.getByRole('button', { name: /snooze/i }));
    await user.click(await screen.findByText('Next week'));

    await waitFor(() => expect(putJson).toHaveBeenCalled());
    expect(vi.mocked(putJson).mock.calls[0][1]).toMatchObject({
      entityType: 'purchase_order',
      entityId: 'po1',
    });
  });
});
