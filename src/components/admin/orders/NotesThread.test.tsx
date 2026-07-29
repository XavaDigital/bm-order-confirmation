import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import { NotesThread, type OrderNote } from './NotesThread';

vi.mock('@/lib/api-fetch', () => ({
  getJson: vi.fn(),
  postJson: vi.fn(),
  patchJson: vi.fn(),
  deleteJson: vi.fn(),
  ApiError: class ApiError extends Error {},
}));

import { deleteJson, getJson, patchJson, postJson } from '@/lib/api-fetch';

const ME = 'staff-me';

function note(overrides: Partial<OrderNote> = {}): OrderNote {
  return {
    id: 'n1',
    orderId: 'order-1',
    garmentId: null,
    garmentName: null,
    bodyHtml: '<p>Use the <strong>navy</strong> thread</p>',
    body: 'Use the navy thread',
    authorKind: 'staff',
    authorName: 'Sam Sales',
    authorEmail: 'sam@x.com',
    authorLabel: 'sam@x.com',
    authorStaffUserId: ME,
    visibility: 'internal',
    createdAt: '2026-07-01T09:00:00Z',
    updatedAt: '2026-07-01T09:00:00Z',
    edited: false,
    deleted: false,
    ...overrides,
  };
}

function renderThread(props: Partial<React.ComponentProps<typeof NotesThread>> = {}) {
  return render(
    <AntdApp>
      <NotesThread orderId="order-1" currentUserId={ME} isAdmin={false} {...props} />
    </AntdApp>,
  );
}

/** Type into the contenteditable, which userEvent cannot `type` into reliably. */
async function writeInEditor(label: string, html: string) {
  const editor = await screen.findByRole('textbox', { name: label });
  editor.innerHTML = html;
  // React listens for `input` on contenteditable; dispatching it is what a real
  // keystroke would do.
  const { fireEvent } = await import('@testing-library/react');
  fireEvent.input(editor);
  return editor;
}

beforeEach(() => {
  vi.mocked(getJson).mockReset().mockResolvedValue([]);
  vi.mocked(postJson).mockReset().mockResolvedValue({ id: 'new' });
  vi.mocked(patchJson).mockReset().mockResolvedValue({});
  vi.mocked(deleteJson).mockReset().mockResolvedValue({ ok: true });
});

describe('NotesThread — reading', () => {
  it('shows an empty state when the thread has no notes', async () => {
    renderThread();

    expect(await screen.findByText(/no notes yet/i)).toBeInTheDocument();
  });

  it('renders a note with its author and formatting', async () => {
    vi.mocked(getJson).mockResolvedValue([note()]);
    renderThread();

    expect(await screen.findByText('Sam Sales')).toBeInTheDocument();
    // The <strong> survives, so the rendered HTML is real formatting.
    expect(screen.getByText('navy').tagName).toBe('STRONG');
  });

  it('reads the order thread by default and the garment thread when scoped', async () => {
    renderThread();
    await waitFor(() => expect(getJson).toHaveBeenCalled());
    expect(vi.mocked(getJson).mock.calls[0][0]).toBe('/api/admin/orders/order-1/notes');

    vi.mocked(getJson).mockClear();
    renderThread({ garmentId: 'g1' });
    await waitFor(() => expect(getJson).toHaveBeenCalled());
    expect(vi.mocked(getJson).mock.calls[0][0]).toBe(
      '/api/admin/orders/order-1/notes?garmentId=g1',
    );
  });

  it('marks an edited note', async () => {
    vi.mocked(getJson).mockResolvedValue([note({ edited: true })]);
    renderThread();

    expect(await screen.findByText('(edited)')).toBeInTheDocument();
  });

  it('badges a note relayed in from Email Flow', async () => {
    vi.mocked(getJson).mockResolvedValue([
      note({ authorKind: 'email_flow', authorName: null, bodyHtml: null, body: 'Customer rang' }),
    ]);
    renderThread();

    expect(await screen.findByText('Email Flow')).toBeInTheDocument();
    expect(screen.getByText('Customer rang')).toBeInTheDocument();
  });

  // Defence in depth: even if a row got past the server sanitiser, the render
  // path must not put a script in the DOM.
  it('sanitises stored HTML again on render', async () => {
    vi.mocked(getJson).mockResolvedValue([
      note({ bodyHtml: '<p onclick="steal()">hi</p><script>alert(1)</script>' }),
    ]);
    const { container } = renderThread();

    await screen.findByText('hi');
    expect(container.querySelector('script')).toBeNull();
    expect(container.innerHTML).not.toContain('onclick');
  });

  it('shows a placeholder for a removed note rather than a gap', async () => {
    vi.mocked(getJson).mockResolvedValue([
      note({ deleted: true, bodyHtml: null, body: '' }),
    ]);
    renderThread();

    expect(await screen.findByText(/this note was removed/i)).toBeInTheDocument();
  });

  it('surfaces a load failure instead of an empty thread', async () => {
    vi.mocked(getJson).mockRejectedValue(new Error('nope'));
    renderThread();

    expect(await screen.findByText('nope')).toBeInTheDocument();
  });
});

describe('NotesThread — writing', () => {
  it('posts the editor HTML and clears the composer', async () => {
    const user = userEvent.setup();
    renderThread();
    await screen.findByText(/no notes yet/i);

    await writeInEditor('New note', '<p>Chase the factory</p>');
    await user.click(screen.getByRole('button', { name: /add note/i }));

    expect(postJson).toHaveBeenCalledWith(
      '/api/admin/orders/order-1/notes',
      { body: '<p>Chase the factory</p>', garmentId: null },
      expect.any(String),
    );
    // Reloaded so the new note appears.
    await waitFor(() => expect(getJson).toHaveBeenCalledTimes(2));
  });

  it('sends garmentId when scoped to a garment', async () => {
    const user = userEvent.setup();
    renderThread({ garmentId: 'g1' });
    await screen.findByText(/no notes/i);

    await writeInEditor('New note', '<p>collar too tight</p>');
    await user.click(screen.getByRole('button', { name: /add note/i }));

    expect(postJson).toHaveBeenCalledWith(
      '/api/admin/orders/order-1/notes',
      { body: '<p>collar too tight</p>', garmentId: 'g1' },
      expect.any(String),
    );
  });

  // An emptied contenteditable holds `<p><br></p>`, which a String.trim() check
  // would treat as content.
  it('keeps the button disabled for a visually empty editor', async () => {
    renderThread();
    await screen.findByText(/no notes yet/i);

    expect(screen.getByRole('button', { name: /add note/i })).toBeDisabled();

    await writeInEditor('New note', '<p><br></p>');
    expect(screen.getByRole('button', { name: /add note/i })).toBeDisabled();

    await writeInEditor('New note', '<p>real content</p>');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /add note/i })).not.toBeDisabled(),
    );
  });
});

describe('NotesThread — editing and removing', () => {
  it('offers edit and remove on your own note', async () => {
    vi.mocked(getJson).mockResolvedValue([note()]);
    renderThread();

    expect(await screen.findByLabelText('Edit note')).toBeInTheDocument();
    expect(screen.getByLabelText('Remove note')).toBeInTheDocument();
  });

  // Editing someone else's note would put your words under their byline.
  it('offers neither on someone else’s note', async () => {
    vi.mocked(getJson).mockResolvedValue([note({ authorStaffUserId: 'someone-else' })]);
    renderThread();

    await screen.findByText('Sam Sales');
    expect(screen.queryByLabelText('Edit note')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Remove note')).not.toBeInTheDocument();
  });

  it('gives an admin remove but not edit on someone else’s note', async () => {
    vi.mocked(getJson).mockResolvedValue([note({ authorStaffUserId: 'someone-else' })]);
    renderThread({ isAdmin: true });

    expect(await screen.findByLabelText('Remove note')).toBeInTheDocument();
    expect(screen.queryByLabelText('Edit note')).not.toBeInTheDocument();
  });

  it('patches an edit with the rewritten body', async () => {
    const user = userEvent.setup();
    vi.mocked(getJson).mockResolvedValue([note()]);
    renderThread();

    await user.click(await screen.findByLabelText('Edit note'));
    await writeInEditor('Edit note by Sam Sales', '<p>royal blue</p>');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(patchJson).toHaveBeenCalledWith(
      '/api/admin/orders/order-1/notes/n1',
      { body: '<p>royal blue</p>' },
      expect.any(String),
    );
  });

  it('seeds the edit box with the existing body', async () => {
    const user = userEvent.setup();
    vi.mocked(getJson).mockResolvedValue([note()]);
    renderThread();

    await user.click(await screen.findByLabelText('Edit note'));

    const editor = await screen.findByRole('textbox', { name: /edit note by/i });
    expect(editor.innerHTML).toContain('navy');
  });

  it('leaves the note alone when an edit is cancelled', async () => {
    const user = userEvent.setup();
    vi.mocked(getJson).mockResolvedValue([note()]);
    renderThread();

    await user.click(await screen.findByLabelText('Edit note'));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(patchJson).not.toHaveBeenCalled();
    expect(await screen.findByLabelText('Edit note')).toBeInTheDocument();
  });

  it('deletes after confirmation', async () => {
    const user = userEvent.setup();
    vi.mocked(getJson).mockResolvedValue([note()]);
    renderThread();

    await user.click(await screen.findByLabelText('Remove note'));
    await user.click(await screen.findByRole('button', { name: 'Remove' }));

    expect(deleteJson).toHaveBeenCalledWith(
      '/api/admin/orders/order-1/notes/n1',
      undefined,
      expect.any(String),
    );
  });

  it('reports the live note count, excluding removed ones', async () => {
    const onCountChange = vi.fn();
    vi.mocked(getJson).mockResolvedValue([note(), note({ id: 'n2', deleted: true })]);
    renderThread({ onCountChange });

    await waitFor(() => expect(onCountChange).toHaveBeenCalledWith(1));
  });
});
