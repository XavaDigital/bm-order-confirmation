import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FabricFieldsManager } from './FabricFieldsManager';

const FIELDS = [
  { label: 'Outer Fabric', options: ['Cotton Fleece', 'Poly Fleece'] },
  { label: 'Hood Lining', options: ['Self-fabric'] },
];

describe('FabricFieldsManager', () => {
  it('renders one card per field with its label and options', () => {
    render(<FabricFieldsManager value={FIELDS} onChange={vi.fn()} />);

    expect(screen.getByDisplayValue('Outer Fabric')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Hood Lining')).toBeInTheDocument();
    expect(screen.getByText('Cotton Fleece')).toBeInTheDocument();
    expect(screen.getByText('Self-fabric')).toBeInTheDocument();
  });

  it('adding a field appends an empty one', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<FabricFieldsManager value={FIELDS} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /add fabric field/i }));
    expect(onChange).toHaveBeenCalledWith([...FIELDS, { label: '', options: [] }]);
  });

  it('editing a field label reports the change', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<FabricFieldsManager value={FIELDS} onChange={onChange} />);

    await user.type(screen.getByDisplayValue('Outer Fabric'), 's');
    expect(onChange).toHaveBeenLastCalledWith([
      { label: 'Outer Fabrics', options: ['Cotton Fleece', 'Poly Fleece'] },
      FIELDS[1],
    ]);
  });

  it('reordering with the move-down button swaps fields', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<FabricFieldsManager value={FIELDS} onChange={onChange} />);

    await user.click(screen.getAllByRole('button', { name: 'Move down' })[0]);
    expect(onChange).toHaveBeenCalledWith([FIELDS[1], FIELDS[0]]);
  });

  it('removing a field confirms then reports the filtered list', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<FabricFieldsManager value={FIELDS} onChange={onChange} />);

    await user.click(screen.getAllByRole('button', { name: 'Remove field' })[0]);
    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(onChange).toHaveBeenCalledWith([FIELDS[1]]);
  });
});
