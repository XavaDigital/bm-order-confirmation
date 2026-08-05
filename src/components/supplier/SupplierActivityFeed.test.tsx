import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import { SupplierActivityFeed } from './SupplierActivityFeed';
import type { PoFileItem } from './SupplierPoFiles';
import type { SupplierComment, SupplierStatusChange } from './po-view-helpers';

function comment(overrides: Partial<SupplierComment> = {}): SupplierComment {
  return {
    id: 'c-1',
    body: 'Please check the collar colour',
    authorKind: 'staff',
    authorLabel: 'dana@example.com',
    createdAt: '2026-08-03T10:00:00Z',
    ...overrides,
  };
}

function file(overrides: Partial<PoFileItem> = {}): PoFileItem {
  return {
    id: 'f-1',
    fileName: 'test-print.png',
    sizeBytes: 2048,
    category: 'Test print',
    uploadedByKind: 'supplier',
    uploadedByLabel: 'Ana (Dynasty)',
    statusAtUpload: 'test_print',
    createdAt: '2026-08-02T10:00:00Z',
    downloadUrl: 'https://signed.example/test-print.png',
    comments: [],
    ...overrides,
  };
}

const statusChange: SupplierStatusChange = {
  from: 'pre_production',
  to: 'test_print',
  at: '2026-08-01T10:00:00Z',
  by: 'Ana (Dynasty)',
};

function renderFeed(props: Partial<Parameters<typeof SupplierActivityFeed>[0]> = {}) {
  return render(
    <AntdApp>
      <SupplierActivityFeed
        comments={[comment()]}
        statusHistory={[statusChange]}
        files={[file()]}
        supplierName="Dynasty"
        onSendComment={vi.fn().mockResolvedValue(undefined)}
        {...props}
      />
    </AntdApp>,
  );
}

describe('SupplierActivityFeed', () => {
  it('merges statuses, files and comments into one chronological stream', () => {
    const { container } = renderFeed();
    const text = container.textContent ?? '';
    const statusAt = text.indexOf('Status:');
    const fileAt = text.indexOf('test-print.png');
    const commentAt = text.indexOf('Please check the collar colour');
    expect(statusAt).toBeGreaterThanOrEqual(0);
    // status (1 Aug) before file (2 Aug) before comment (3 Aug).
    expect(statusAt).toBeLessThan(fileAt);
    expect(fileAt).toBeLessThan(commentAt);
  });

  it('renders a status change as a compact system line', () => {
    renderFeed();
    expect(
      screen.getByText(/Status: Design prep → Test print — Ana \(Dynasty\), /),
    ).toBeInTheDocument();
  });

  it('shows image uploads as inline thumbnails linked to the signed URL', () => {
    renderFeed();
    const img = screen.getByAltText('test-print.png');
    expect(img).toHaveAttribute('src', 'https://signed.example/test-print.png');
    expect(img.closest('a')).toHaveAttribute('href', 'https://signed.example/test-print.png');
  });

  it('renders non-image files as a download link without a thumbnail', () => {
    renderFeed({
      files: [file({ fileName: 'layout.pdf', downloadUrl: 'https://signed.example/layout.pdf' })],
    });
    // No thumbnail <img> — antd icons also expose role="img", so check by alt.
    expect(screen.queryByAltText('layout.pdf')).not.toBeInTheDocument();
    const link = screen.getByText('layout.pdf').closest('a');
    expect(link).toHaveAttribute('href', 'https://signed.example/layout.pdf');
  });

  it('posts a per-file comment through the file entry composer', async () => {
    const user = userEvent.setup();
    const onSendFileComment = vi.fn().mockResolvedValue(undefined);
    renderFeed({ onSendFileComment });

    await user.type(screen.getByLabelText('Comment on test-print.png'), 'Too dark, reprint');
    await user.click(screen.getByRole('button', { name: 'Send comment on test-print.png' }));

    expect(onSendFileComment).toHaveBeenCalledWith('f-1', 'Too dark, reprint');
  });

  it('hides per-file composers when no handler is given (the token surface)', () => {
    renderFeed({ onSendFileComment: undefined });
    expect(screen.queryByLabelText('Comment on test-print.png')).not.toBeInTheDocument();
  });

  it('shows existing file comments inside the file entry', () => {
    renderFeed({
      files: [
        file({
          comments: [
            {
              id: 'fc-1',
              body: 'Colour is washed out',
              authorKind: 'supplier',
              authorName: null,
              authorLabel: null,
              createdAt: '2026-08-02T12:00:00Z',
            },
          ],
        }),
      ],
    });
    expect(screen.getByText('Colour is washed out')).toBeInTheDocument();
    // Supplier comment without a label falls back to the supplier name.
    expect(screen.getByText('Dynasty')).toBeInTheDocument();
  });

  it('sends a general comment and clears the draft', async () => {
    const user = userEvent.setup();
    const onSendComment = vi.fn().mockResolvedValue(undefined);
    renderFeed({ onSendComment });

    const box = screen.getByPlaceholderText('Add a comment…');
    await user.type(box, 'Thanks, approved');
    await user.click(screen.getByRole('button', { name: /send$/i }));

    expect(onSendComment).toHaveBeenCalledWith('Thanks, approved');
    await vi.waitFor(() => expect(box).toHaveValue(''));
  });

  it('works without files at all — comments and statuses only', () => {
    renderFeed({ files: undefined });
    expect(screen.getByText(/Status: Design prep → Test print/)).toBeInTheDocument();
    expect(screen.getByText('Please check the collar colour')).toBeInTheDocument();
    expect(screen.queryByText('test-print.png')).not.toBeInTheDocument();
  });

  it('shows the empty state with no activity', () => {
    renderFeed({ comments: [], statusHistory: [], files: [] });
    expect(screen.getByText('No activity yet')).toBeInTheDocument();
  });
});
