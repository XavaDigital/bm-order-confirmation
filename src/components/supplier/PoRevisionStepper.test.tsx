import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PoRevisionStepper, type PoRevisionInfo } from './PoRevisionStepper';

const REVISIONS: PoRevisionInfo[] = [
  { revisionNumber: 1, reason: null, createdAt: '2026-08-01T10:00:00.000Z' },
  { revisionNumber: 2, reason: 'Size fix', createdAt: '2026-08-03T10:00:00.000Z' },
  { revisionNumber: 3, reason: 'Added singlets', createdAt: '2026-08-05T10:00:00.000Z' },
];

describe('PoRevisionStepper', () => {
  it('renders nothing when the PO has a single revision', () => {
    const { container } = render(
      <PoRevisionStepper
        revisions={[REVISIONS[0]]}
        current={1}
        summary={null}
        onChange={() => {}}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows "Revision N of M" with the viewed revision reason, and steps both ways', async () => {
    const onChange = vi.fn();
    render(
      <PoRevisionStepper revisions={REVISIONS} current={2} summary={[]} onChange={onChange} />,
    );

    expect(screen.getByText('Revision 2 of 3')).toBeInTheDocument();
    expect(screen.getByText(/Size fix/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Previous revision' }));
    expect(onChange).toHaveBeenCalledWith(1);
    await userEvent.click(screen.getByRole('button', { name: 'Next revision' }));
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it('disables ‹ on the first revision and › on the latest', () => {
    const { rerender } = render(
      <PoRevisionStepper revisions={REVISIONS} current={1} summary={null} onChange={() => {}} />,
    );
    expect(screen.getByRole('button', { name: 'Previous revision' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next revision' })).toBeEnabled();

    rerender(
      <PoRevisionStepper revisions={REVISIONS} current={3} summary={null} onChange={() => {}} />,
    );
    expect(screen.getByRole('button', { name: 'Previous revision' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Next revision' })).toBeDisabled();
  });

  it('flags an older revision and lists the "what changed" summary against the predecessor', () => {
    render(
      <PoRevisionStepper
        revisions={REVISIONS}
        current={2}
        summary={['Hoodie: 1 sizing line changed (Size)', 'Garment added: Singlet']}
        onChange={() => {}}
      />,
    );

    expect(
      screen.getByText('You are viewing an older revision — revision 3 is the current one.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Changed since revision 1')).toBeInTheDocument();
    expect(screen.getByText('Hoodie: 1 sizing line changed (Size)')).toBeInTheDocument();
    expect(screen.getByText('Garment added: Singlet')).toBeInTheDocument();
  });

  it('says so when a revision has no content changes, and shows nothing to compare on revision 1', () => {
    const { rerender } = render(
      <PoRevisionStepper revisions={REVISIONS} current={3} summary={[]} onChange={() => {}} />,
    );
    expect(screen.getByText(/No content changes/)).toBeInTheDocument();
    expect(screen.queryByText(/viewing an older revision/)).not.toBeInTheDocument();

    rerender(
      <PoRevisionStepper revisions={REVISIONS} current={1} summary={null} onChange={() => {}} />,
    );
    expect(screen.queryByText(/Changed since/)).not.toBeInTheDocument();
  });
});
