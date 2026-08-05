import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import type { GarmentTypeOption } from '@/db/schema';
import { OrderOptionsManager } from './OrderOptionsManager';

function renderManager(value: GarmentTypeOption[] = [], onChange = vi.fn()) {
  render(
    <AntdApp>
      <OrderOptionsManager value={value} onChange={onChange} />
    </AntdApp>,
  );
  return onChange;
}

/** The modal's footer OK button — 'Add'/'Update' also appears inside the body. */
function modalOkButton(name: string) {
  const footer = document.querySelector('.ant-modal-footer');
  expect(footer).not.toBeNull();
  return within(footer as HTMLElement).getByRole('button', { name });
}

describe('OrderOptionsManager required toggle', () => {
  it('persists required: true on a new select option when the toggle is checked', async () => {
    const user = userEvent.setup();
    const onChange = renderManager();

    await user.click(screen.getByRole('button', { name: /add option/i }));
    await user.type(screen.getByPlaceholderText('Enter option label'), 'Cord Color');
    await user.type(screen.getByPlaceholderText('Enter a value'), 'black{Enter}');
    await user.click(screen.getByRole('checkbox', { name: /required — staff must answer/i }));
    await user.click(modalOkButton('Add'));

    expect(onChange).toHaveBeenCalledWith([
      { label: 'Cord Color', type: 'select', options: ['black'], required: true },
    ]);
  });

  it('omits required entirely when the toggle is left unchecked', async () => {
    const user = userEvent.setup();
    const onChange = renderManager();

    await user.click(screen.getByRole('button', { name: /add option/i }));
    await user.type(screen.getByPlaceholderText('Enter option label'), 'Zip Type');
    await user.type(screen.getByPlaceholderText('Enter a value'), 'full-zip{Enter}');
    await user.click(modalOkButton('Add'));

    expect(onChange).toHaveBeenCalledWith([
      { label: 'Zip Type', type: 'select', options: ['full-zip'] },
    ]);
    expect('required' in onChange.mock.calls[0][0][0]).toBe(false);
  });

  it('persists required: true on a free-text option', async () => {
    const user = userEvent.setup();
    const onChange = renderManager();

    await user.click(screen.getByRole('button', { name: /add option/i }));
    await user.type(screen.getByPlaceholderText('Enter option label'), 'Waist Label');
    await user.click(screen.getByRole('radio', { name: 'Free text' }));
    await user.click(screen.getByRole('checkbox', { name: /required — staff must answer/i }));
    await user.click(modalOkButton('Add'));

    expect(onChange).toHaveBeenCalledWith([
      { label: 'Waist Label', type: 'text', required: true },
    ]);
  });

  it('hides the Required toggle for checkbox options — unchecked is an answer', async () => {
    const user = userEvent.setup();
    renderManager();

    await user.click(screen.getByRole('button', { name: /add option/i }));
    expect(
      screen.getByRole('checkbox', { name: /required — staff must answer/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Checkbox' }));
    expect(
      screen.queryByRole('checkbox', { name: /required — staff must answer/i }),
    ).not.toBeInTheDocument();
  });

  it('seeds the toggle from an existing required option and drops required when unchecked', async () => {
    const user = userEvent.setup();
    const onChange = renderManager([{ label: 'Cord Color', type: 'text', required: true }]);

    await user.click(screen.getByTitle('Edit option'));
    const toggle = screen.getByRole('checkbox', { name: /required — staff must answer/i });
    expect(toggle).toBeChecked();

    await user.click(toggle);
    await user.click(modalOkButton('Update'));

    expect(onChange).toHaveBeenCalledWith([{ label: 'Cord Color', type: 'text' }]);
    expect('required' in onChange.mock.calls[0][0][0]).toBe(false);
  });

  it('shows a Required tag in the options table for required options only', () => {
    renderManager([
      { label: 'Cord Color', type: 'select', options: ['black'], required: true },
      { label: 'Zip Type', type: 'select', options: ['full-zip'] },
    ]);

    expect(screen.getAllByText('Required')).toHaveLength(1);
  });
});
