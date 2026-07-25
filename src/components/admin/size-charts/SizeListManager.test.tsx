import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SizeListManager } from './SizeListManager';

const SIZES = [
  { label: 'M', tall: false },
  { label: 'L', tall: true },
];

describe('SizeListManager', () => {
  it('renders the size rows with their tall state', () => {
    render(<SizeListManager value={SIZES} onChange={vi.fn()} />);

    expect(screen.getByText('M')).toBeInTheDocument();
    expect(screen.getByText('L')).toBeInTheDocument();
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes[0]).not.toBeChecked();
    expect(checkboxes[1]).toBeChecked();
  });

  it('adds a size via the input (Enter), ignoring duplicates case-insensitively', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SizeListManager value={SIZES} onChange={onChange} />);

    await user.type(screen.getByPlaceholderText(/add size/i), 'XL{Enter}');
    expect(onChange).toHaveBeenCalledWith([...SIZES, { label: 'XL', tall: false }]);

    onChange.mockClear();
    await user.type(screen.getByPlaceholderText(/add size/i), 'm{Enter}');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('toggling tall reports the updated list', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SizeListManager value={SIZES} onChange={onChange} />);

    await user.click(screen.getAllByRole('checkbox')[0]);
    expect(onChange).toHaveBeenCalledWith([
      { label: 'M', tall: true },
      { label: 'L', tall: true },
    ]);
  });

  it('removing a size reports the filtered list', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SizeListManager value={SIZES} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Remove M' }));
    expect(onChange).toHaveBeenCalledWith([{ label: 'L', tall: true }]);
  });
});
