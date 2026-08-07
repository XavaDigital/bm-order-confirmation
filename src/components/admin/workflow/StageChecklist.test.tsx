import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import { StageChecklist, type Checklist, type ChecklistTask } from './StageChecklist';

vi.mock('@/lib/api-fetch', () => ({
  getJson: vi.fn(),
  postJson: vi.fn(),
  patchJson: vi.fn(),
  deleteJson: vi.fn(),
  ApiError: class ApiError extends Error {},
}));

import { deleteJson, getJson, postJson } from '@/lib/api-fetch';

function task(overrides: Partial<ChecklistTask> = {}): ChecklistTask {
  return {
    id: 't1',
    slug: 'artwork_approved',
    name: 'Artwork approved',
    description: 'Final artwork signed off internally.',
    isBlocking: true,
    policy: 'any',
    gateKeys: ['po_send'],
    satisfied: false,
    confirmations: [],
    awaiting: [],
    allowSidestep: false,
    sidestepped: false,
    sidestepReason: null,
    ...overrides,
  };
}

function checklist(overrides: Partial<Checklist> = {}): Checklist {
  return {
    entityType: 'order',
    entityId: 'order-1',
    stageSlug: 'artwork',
    stageName: 'Artwork',
    tasks: [task()],
    canLeaveStage: false,
    nextStageSlug: 'digitising',
    ...overrides,
  };
}

function renderChecklist(props: Partial<React.ComponentProps<typeof StageChecklist>> = {}) {
  return render(
    <AntdApp>
      <StageChecklist boardKey="order" entityId="order-1" isAdmin={false} {...props} />
    </AntdApp>,
  );
}

beforeEach(() => {
  vi.mocked(getJson).mockReset().mockResolvedValue(checklist());
  vi.mocked(postJson).mockReset().mockResolvedValue({ advancedToStageSlug: null });
  vi.mocked(deleteJson).mockReset().mockResolvedValue({ ok: true });
});

describe('StageChecklist — rendering', () => {
  it('shows the stage and its tasks', async () => {
    renderChecklist();

    expect(await screen.findByText('Artwork')).toBeInTheDocument();
    expect(screen.getByText('Artwork approved')).toBeInTheDocument();
    expect(screen.getByText(/final artwork signed off/i)).toBeInTheDocument();
  });

  it('says when checks are outstanding, and when they are done', async () => {
    renderChecklist();
    expect(await screen.findByText('Checks outstanding')).toBeInTheDocument();

    vi.mocked(getJson).mockResolvedValue(
      checklist({ tasks: [task({ satisfied: true })], canLeaveStage: true }),
    );
    renderChecklist();
    expect(await screen.findByText('Ready to move on')).toBeInTheDocument();
  });

  // "Optional" would be wrong: it does not hold the job, but it does hold the
  // purchase order.
  it('labels a non-blocking task without calling it optional', async () => {
    vi.mocked(getJson).mockResolvedValue(
      checklist({ tasks: [task({ isBlocking: false, name: 'Colour sample' })] }),
    );
    renderChecklist();

    expect(await screen.findByText('Non-blocking')).toBeInTheDocument();
    expect(screen.queryByText(/optional/i)).not.toBeInTheDocument();
  });

  it('marks a gated task', async () => {
    renderChecklist();
    expect(await screen.findByText('Gated')).toBeInTheDocument();
  });

  it('marks an all-owners task', async () => {
    vi.mocked(getJson).mockResolvedValue(checklist({ tasks: [task({ policy: 'all' })] }));
    renderChecklist();

    expect(await screen.findByText('All owners')).toBeInTheDocument();
  });

  it('names who confirmed a task', async () => {
    vi.mocked(getJson).mockResolvedValue(
      checklist({
        tasks: [
          task({
            satisfied: true,
            confirmations: [
              { staffUserId: 'u1', email: 'sam@x.com', confirmedAt: '2026-07-20T10:00:00Z', note: null },
            ],
          }),
        ],
      }),
    );
    renderChecklist();

    expect(await screen.findByText(/confirmed by sam@x.com/i)).toBeInTheDocument();
  });

  it('says how many owners are still awaited under an all policy', async () => {
    vi.mocked(getJson).mockResolvedValue(
      checklist({ tasks: [task({ policy: 'all', awaiting: ['u2', 'u3'] })] }),
    );
    renderChecklist();

    expect(await screen.findByText(/waiting on 2 more owners/i)).toBeInTheDocument();
  });

  it('uses the singular for one awaited owner', async () => {
    vi.mocked(getJson).mockResolvedValue(
      checklist({ tasks: [task({ policy: 'all', awaiting: ['u2'] })] }),
    );
    renderChecklist();

    expect(await screen.findByText(/waiting on 1 more owner$/i)).toBeInTheDocument();
  });

  it('shows an empty state for a stage with no checks', async () => {
    vi.mocked(getJson).mockResolvedValue(checklist({ tasks: [] }));
    renderChecklist();

    expect(await screen.findByText(/no checks on the artwork stage/i)).toBeInTheDocument();
  });

  it('surfaces a load failure', async () => {
    vi.mocked(getJson).mockRejectedValue(new Error('checklist is down'));
    renderChecklist();

    expect(await screen.findByText('checklist is down')).toBeInTheDocument();
  });
});

describe('StageChecklist — confirming', () => {
  it('posts the confirmation and reloads', async () => {
    const user = userEvent.setup();
    renderChecklist();

    await user.click(await screen.findByRole('checkbox', { name: 'Confirm Artwork approved' }));

    expect(postJson).toHaveBeenCalledWith(
      '/api/admin/workflow/tasks',
      { boardKey: 'order', entityId: 'order-1', taskId: 't1' },
      expect.any(String),
    );
    await waitFor(() => expect(getJson).toHaveBeenCalledTimes(2));
  });

  it('reports an advance to the caller so the page can refresh', async () => {
    const user = userEvent.setup();
    const onAdvanced = vi.fn();
    vi.mocked(postJson).mockResolvedValue({ advancedToStageSlug: 'digitising' });
    renderChecklist({ onAdvanced });

    await user.click(await screen.findByRole('checkbox', { name: 'Confirm Artwork approved' }));

    await waitFor(() => expect(onAdvanced).toHaveBeenCalledWith('digitising'));
  });

  it('does not call back when nothing advanced', async () => {
    const user = userEvent.setup();
    const onAdvanced = vi.fn();
    renderChecklist({ onAdvanced });

    await user.click(await screen.findByRole('checkbox', { name: 'Confirm Artwork approved' }));

    await waitFor(() => expect(postJson).toHaveBeenCalled());
    expect(onAdvanced).not.toHaveBeenCalled();
  });

  // Unticking is a separate, admin-only action — a checkbox that could be
  // toggled off would imply anyone can undo someone else's sign-off.
  it('locks a confirmed checkbox rather than letting it be unticked', async () => {
    vi.mocked(getJson).mockResolvedValue(checklist({ tasks: [task({ satisfied: true })] }));
    renderChecklist();

    expect(await screen.findByRole('checkbox', { name: 'Confirm Artwork approved' })).toBeDisabled();
  });
});

describe('StageChecklist — reopening', () => {
  it('offers reopen to an admin on a confirmed task', async () => {
    vi.mocked(getJson).mockResolvedValue(checklist({ tasks: [task({ satisfied: true })] }));
    renderChecklist({ isAdmin: true });

    expect(await screen.findByLabelText('Reopen Artwork approved')).toBeInTheDocument();
  });

  it('does not offer reopen to a non-admin', async () => {
    vi.mocked(getJson).mockResolvedValue(checklist({ tasks: [task({ satisfied: true })] }));
    renderChecklist({ isAdmin: false });

    await screen.findByText('Artwork approved');
    expect(screen.queryByLabelText('Reopen Artwork approved')).not.toBeInTheDocument();
  });

  it('does not offer reopen on an unconfirmed task', async () => {
    renderChecklist({ isAdmin: true });

    await screen.findByText('Artwork approved');
    expect(screen.queryByLabelText('Reopen Artwork approved')).not.toBeInTheDocument();
  });

  it('sends the reopen request', async () => {
    const user = userEvent.setup();
    vi.mocked(getJson).mockResolvedValue(checklist({ tasks: [task({ satisfied: true })] }));
    renderChecklist({ isAdmin: true });

    await user.click(await screen.findByLabelText('Reopen Artwork approved'));

    expect(deleteJson).toHaveBeenCalledWith(
      '/api/admin/workflow/tasks',
      { boardKey: 'order', entityId: 'order-1', taskId: 't1' },
      expect.any(String),
    );
  });
});

describe('StageChecklist — sidestepping', () => {
  it('offers Sidestep only on outstanding tasks configured to allow it', async () => {
    vi.mocked(getJson).mockResolvedValue(
      checklist({ tasks: [task({ allowSidestep: true })] }),
    );
    renderChecklist();

    expect(await screen.findByRole('button', { name: 'Sidestep' })).toBeInTheDocument();
  });

  it('does not offer Sidestep when the task does not allow it', async () => {
    renderChecklist();

    await screen.findByText('Artwork approved');
    expect(screen.queryByRole('button', { name: 'Sidestep' })).not.toBeInTheDocument();
  });

  it('does not offer Sidestep once the task is satisfied', async () => {
    vi.mocked(getJson).mockResolvedValue(
      checklist({ tasks: [task({ allowSidestep: true, satisfied: true })] }),
    );
    renderChecklist();

    await screen.findByText('Artwork approved');
    expect(screen.queryByRole('button', { name: 'Sidestep' })).not.toBeInTheDocument();
  });

  it('sidesteps with a reason: POSTs the reason and reloads', async () => {
    const user = userEvent.setup();
    vi.mocked(getJson).mockResolvedValue(
      checklist({ tasks: [task({ allowSidestep: true })] }),
    );
    renderChecklist();

    await user.click(await screen.findByRole('button', { name: 'Sidestep' }));
    expect(await screen.findByText(/acknowledged rather than done/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Reason for sidestepping'), 'no sample requested');
    await user.click(screen.getByRole('button', { name: 'Record sidestep' }));

    await waitFor(() =>
      expect(postJson).toHaveBeenCalledWith(
        '/api/admin/workflow/tasks',
        { boardKey: 'order', entityId: 'order-1', taskId: 't1', sidestepReason: 'no sample requested' },
        expect.any(String),
      ),
    );
    await waitFor(() => expect(getJson).toHaveBeenCalledTimes(2));
  });

  it('refuses to send a reason shorter than a few characters', async () => {
    const user = userEvent.setup();
    vi.mocked(getJson).mockResolvedValue(
      checklist({ tasks: [task({ allowSidestep: true })] }),
    );
    renderChecklist();

    await user.click(await screen.findByRole('button', { name: 'Sidestep' }));
    await user.type(await screen.findByLabelText('Reason for sidestepping'), 'x');
    await user.click(screen.getByRole('button', { name: 'Record sidestep' }));

    expect(await screen.findByText(/give a reason/i)).toBeInTheDocument();
    expect(postJson).not.toHaveBeenCalled();
  });

  it('keeps the modal open and shows the server refusal when the task cannot be sidestepped', async () => {
    const user = userEvent.setup();
    vi.mocked(getJson).mockResolvedValue(
      checklist({ tasks: [task({ allowSidestep: true })] }),
    );
    vi.mocked(postJson).mockRejectedValue(
      new Error('"Artwork approved" cannot be sidestepped — it has to be done'),
    );
    renderChecklist();

    await user.click(await screen.findByRole('button', { name: 'Sidestep' }));
    await user.type(await screen.findByLabelText('Reason for sidestepping'), 'no sample requested');
    await user.click(screen.getByRole('button', { name: 'Record sidestep' }));

    expect(
      await screen.findByText(/cannot be sidestepped — it has to be done/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Reason for sidestepping')).toBeInTheDocument();
  });

  it('renders a sidestepped task distinctly, with its reason', async () => {
    vi.mocked(getJson).mockResolvedValue(
      checklist({
        tasks: [
          task({
            allowSidestep: true,
            satisfied: true,
            sidestepped: true,
            sidestepReason: 'no sample requested',
            confirmations: [
              { staffUserId: 'u1', email: 'sam@x.com', confirmedAt: '2026-07-20T10:00:00Z', note: null },
            ],
          }),
        ],
      }),
    );
    renderChecklist();

    expect(await screen.findByText('Sidestepped')).toBeInTheDocument();
    expect(
      screen.getByText('Sidestepped by sam@x.com — "no sample requested"'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^confirmed by/i)).not.toBeInTheDocument();
  });
});
