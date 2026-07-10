import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RequestChangesModal } from './RequestChangesModal';

describe('RequestChangesModal', () => {
  it('Submit Request is disabled until a comment is entered, and submits the trimmed comment', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<RequestChangesModal open onCancel={vi.fn()} onSubmit={onSubmit} />);

    expect(screen.getByRole('button', { name: /submit request/i })).toBeDisabled();

    await user.type(screen.getByPlaceholderText(/the sizing for jersey/i), '  Make it bigger  ');
    await user.click(screen.getByRole('button', { name: /submit request/i }));

    expect(onSubmit).toHaveBeenCalledWith('Make it bigger');
  });

  it('clears the comment field after a successful submit', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<RequestChangesModal open onCancel={vi.fn()} onSubmit={onSubmit} />);

    const textarea = screen.getByPlaceholderText(/the sizing for jersey/i);
    await user.type(textarea, 'Fix the logo colour');
    await user.click(screen.getByRole('button', { name: /submit request/i }));

    await vi.waitFor(() => expect(textarea).toHaveValue(''));
  });

  it('Cancel button clears the comment and calls onCancel when not submitting', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<RequestChangesModal open onCancel={onCancel} onSubmit={vi.fn()} />);

    await user.type(screen.getByPlaceholderText(/the sizing for jersey/i), 'Some notes');
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(onCancel).toHaveBeenCalled();
  });

  it('Cancel is disabled while a submit is in flight', async () => {
    const user = userEvent.setup();
    let resolveSubmit: () => void = () => {};
    const onSubmit = vi.fn(
      () => new Promise<void>((resolve) => { resolveSubmit = resolve; }),
    );
    render(<RequestChangesModal open onCancel={vi.fn()} onSubmit={onSubmit} />);

    await user.type(screen.getByPlaceholderText(/the sizing for jersey/i), 'Some notes');
    await user.click(screen.getByRole('button', { name: /submit request/i }));

    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeDisabled();

    resolveSubmit();
    await vi.waitFor(() => expect(screen.getByRole('button', { name: /^cancel$/i })).toBeEnabled());
  });

  it('renders nothing interactive when closed', () => {
    render(<RequestChangesModal open={false} onCancel={vi.fn()} onSubmit={vi.fn()} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
