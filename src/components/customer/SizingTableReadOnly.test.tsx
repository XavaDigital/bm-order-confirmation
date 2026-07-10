import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SizingTableReadOnly } from './SizingTableReadOnly';

describe('SizingTableReadOnly', () => {
  it('shows a placeholder message when there are no rows', () => {
    render(<SizingTableReadOnly rows={[]} />);

    expect(screen.getByText('No sizing specified')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('renders a table row per sizing entry', () => {
    render(
      <SizingTableReadOnly
        rows={[
          { size: 'M', playerName: 'Jane Coach', playerNumber: '7', notes: 'Extra long' },
          { size: 'L', playerName: null, playerNumber: null, notes: null },
        ]}
      />,
    );

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('Jane Coach')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('Extra long')).toBeInTheDocument();
    // Second row's null fields fall back to an em dash placeholder.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
  });
});
