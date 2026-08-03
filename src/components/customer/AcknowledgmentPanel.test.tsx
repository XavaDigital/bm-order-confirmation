import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AcknowledgmentPanel, type Ack } from './AcknowledgmentPanel';

// The live set is admin-editable (acknowledgement_settings) and arrives via
// props — the panel renders whatever it is given.
const ACKS: Ack[] = [
  { key: 'one', title: 'First thing', body: 'I confirm the first thing.' },
  { key: 'two', title: 'Second thing', body: 'I confirm the second thing.' },
  { key: 'three', title: 'Third thing', body: 'I confirm the third thing.' },
];

describe('AcknowledgmentPanel', () => {
  it('gives every ack checkbox an accessible name carrying title and wording', () => {
    render(<AcknowledgmentPanel acks={ACKS} checked={new Set()} onChange={vi.fn()} />);

    for (const ack of ACKS) {
      expect(
        screen.getByRole('checkbox', { name: `${ack.title} ${ack.body}` }),
      ).toBeInTheDocument();
    }
  });

  it('toggles a checkbox on when its label text (not just the input) is clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AcknowledgmentPanel acks={ACKS} checked={new Set()} onChange={onChange} />);

    await user.click(screen.getByText(ACKS[0].body));

    expect(onChange).toHaveBeenCalledWith(new Set([ACKS[0].key]));
  });

  it('toggles a checked ack off when clicked again', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <AcknowledgmentPanel acks={ACKS} checked={new Set([ACKS[0].key])} onChange={onChange} />,
    );

    await user.click(screen.getByRole('checkbox', { name: `${ACKS[0].title} ${ACKS[0].body}` }));

    expect(onChange).toHaveBeenCalledWith(new Set());
  });

  it('announces the confirmed count via an aria-live region', () => {
    render(
      <AcknowledgmentPanel acks={ACKS} checked={new Set([ACKS[0].key])} onChange={vi.fn()} />,
    );

    const status = screen.getByText(`1 of ${ACKS.length} confirmed`);
    expect(status.closest('[aria-live]')).toHaveAttribute('aria-live', 'polite');
  });
});
