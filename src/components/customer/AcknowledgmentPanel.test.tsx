import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ACKNOWLEDGMENTS, AcknowledgmentPanel } from './AcknowledgmentPanel';

describe('AcknowledgmentPanel', () => {
  it('gives every ack checkbox an accessible name matching its text', () => {
    render(<AcknowledgmentPanel checked={new Set()} onChange={vi.fn()} />);

    for (const ack of ACKNOWLEDGMENTS) {
      expect(
        screen.getByRole('checkbox', { name: ack.text }),
      ).toBeInTheDocument();
    }
  });

  it('toggles a checkbox on when its label text (not just the input) is clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AcknowledgmentPanel checked={new Set()} onChange={onChange} />);

    await user.click(screen.getByText(ACKNOWLEDGMENTS[0].text));

    expect(onChange).toHaveBeenCalledWith(new Set([ACKNOWLEDGMENTS[0].key]));
  });

  it('toggles a checked ack off when clicked again', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <AcknowledgmentPanel checked={new Set([ACKNOWLEDGMENTS[0].key])} onChange={onChange} />,
    );

    await user.click(screen.getByRole('checkbox', { name: ACKNOWLEDGMENTS[0].text }));

    expect(onChange).toHaveBeenCalledWith(new Set());
  });

  it('announces the confirmed count via an aria-live region', () => {
    render(
      <AcknowledgmentPanel checked={new Set([ACKNOWLEDGMENTS[0].key])} onChange={vi.fn()} />,
    );

    const status = screen.getByText(`1 of ${ACKNOWLEDGMENTS.length} confirmed`);
    expect(status.closest('[aria-live]')).toHaveAttribute('aria-live', 'polite');
  });
});
