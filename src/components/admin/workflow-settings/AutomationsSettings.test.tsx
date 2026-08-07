import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp } from 'antd';

vi.mock('@/lib/api-fetch', () => ({
  ApiError: class ApiError extends Error {},
  getJson: vi.fn(),
  postJson: vi.fn(),
  patchJson: vi.fn(),
}));

import { getJson, patchJson, postJson } from '@/lib/api-fetch';
import {
  AutomationsSettings,
  describeAutomation,
  type AutomationRuleRow,
} from './AutomationsSettings';

function rule(overrides: Partial<AutomationRuleRow> = {}): AutomationRuleRow {
  return {
    id: 'rule-1',
    name: 'Test print to QC',
    trigger: 'po_file_uploaded',
    triggerConfig: { category: 'Test print' },
    action: 'set_status',
    actionConfig: { status: 'quality_control' },
    isActive: true,
    ...overrides,
  };
}

function renderPanel(canMutate: boolean, rules: AutomationRuleRow[]) {
  vi.mocked(getJson).mockResolvedValueOnce({ items: rules });
  return render(
    <AntdApp>
      <AutomationsSettings canMutate={canMutate} />
    </AntdApp>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

// The describer is the whole point of the panel: a rule nobody can read is a
// rule nobody can trust. Every trigger × action pair, plus what a half-written
// or unrecognised rule reads as.
describe('describeAutomation', () => {
  it('says which status a purchase order moved into', () => {
    expect(
      describeAutomation({
        trigger: 'po_status_changed',
        triggerConfig: { to: 'in_production' },
        action: 'notify',
        actionConfig: { recipients: ['admin'] },
      }),
    ).toBe('When a purchase order moves to Production → notify the admins');
  });

  /**
   * The skipped-check condition (David, 2026-08-07). A rule that fires on only
   * SOME moves to Production reads as broken unless the sentence says why, so
   * the condition has to appear in the sentence rather than only in the form.
   */
  it('says when a rule is narrowed to jobs carrying a skipped check', () => {
    expect(
      describeAutomation({
        trigger: 'po_status_changed',
        triggerConfig: { to: 'in_production', sidestepped: 'yes' },
        action: 'notify',
        actionConfig: { recipients: ['admin'] },
      }),
    ).toBe(
      'When a purchase order moves to Production with a check that was skipped rather than done → notify the admins',
    );
  });

  it('leaves the sentence alone when the rule is not narrowed', () => {
    expect(
      describeAutomation({
        trigger: 'po_status_changed',
        triggerConfig: { to: 'in_production' },
        action: 'notify',
        actionConfig: { recipients: ['admin'] },
      }),
    ).not.toContain('skipped');
  });

  // The labels differ from the stored values (approved = Review, sent =
  // Unconfirmed …) — the sentence must speak the production vocabulary.
  it('uses the display label, not the stored status value', () => {
    expect(
      describeAutomation({
        trigger: 'po_checklist_complete',
        action: 'set_status',
        actionConfig: { status: 'approved' },
      }),
    ).toBe('When the pre-send checklist is complete → move the purchase order to Review');
  });

  it('names the file category that was uploaded', () => {
    expect(
      describeAutomation({
        trigger: 'po_file_uploaded',
        triggerConfig: { category: 'Test print' },
        action: 'set_status',
        actionConfig: { status: 'quality_control' },
      }),
    ).toBe(
      'When a Test print is uploaded to a purchase order → move the purchase order to Quality control',
    );
  });

  it('reads an uncategorised file rule as any file', () => {
    expect(
      describeAutomation({
        trigger: 'po_file_uploaded',
        triggerConfig: {},
        action: 'add_note',
        actionConfig: { body: 'Factory sent something' },
      }),
    ).toBe(
      'When any file is uploaded to a purchase order → add a note: “Factory sent something”',
    );
  });

  it('reads a status trigger with no status as any status change', () => {
    expect(
      describeAutomation({
        trigger: 'po_status_changed',
        triggerConfig: {},
        action: 'notify',
        actionConfig: { recipients: ['sales', 'supplier'] },
      }),
    ).toBe('When a purchase order changes status → notify the sales team and the supplier');
  });

  it('lists three recipients with commas and a final and', () => {
    expect(
      describeAutomation({
        trigger: 'po_checklist_complete',
        action: 'notify',
        actionConfig: { recipients: ['admin', 'po_creator', 'supplier'] },
      }),
    ).toBe(
      'When the pre-send checklist is complete → notify the admins, whoever created the purchase order and the supplier',
    );
  });

  // Cut back to the last whole word — a note sliced mid-word reads as a typo.
  it('truncates a long note so the sentence stays a sentence', () => {
    const sentence = describeAutomation({
      trigger: 'po_checklist_complete',
      action: 'add_note',
      actionConfig: {
        body: 'Everything on the pre-send checklist is done, so this purchase order is ready to go to the factory now',
      },
    });
    expect(sentence).toBe(
      'When the pre-send checklist is complete → add a note: “Everything on the pre-send checklist is done, so this…”',
    );
  });

  it('leaves a note that fits exactly as it is', () => {
    expect(
      describeAutomation({
        trigger: 'po_checklist_complete',
        action: 'add_note',
        actionConfig: { body: 'Ready for the factory' },
      }),
    ).toBe('When the pre-send checklist is complete → add a note: “Ready for the factory”');
  });

  it('collapses whitespace in a note preview', () => {
    expect(
      describeAutomation({
        trigger: 'po_checklist_complete',
        action: 'add_note',
        actionConfig: { body: '  Ready\n\nto  send  ' },
      }),
    ).toBe('When the pre-send checklist is complete → add a note: “Ready to send”');
  });

  // --- graceful degradation --------------------------------------------------

  it('says nobody is notified when the recipient list is empty', () => {
    expect(
      describeAutomation({
        trigger: 'po_checklist_complete',
        action: 'notify',
        actionConfig: { recipients: [] },
      }),
    ).toBe('When the pre-send checklist is complete → notify nobody yet');
  });

  it('says no status is chosen when a move has no target', () => {
    expect(
      describeAutomation({ trigger: 'po_checklist_complete', action: 'set_status' }),
    ).toBe(
      'When the pre-send checklist is complete → move the purchase order (no status chosen yet)',
    );
  });

  it('says nothing is written when a note rule has no body', () => {
    expect(
      describeAutomation({
        trigger: 'po_checklist_complete',
        action: 'add_note',
        actionConfig: { body: '   ' },
      }),
    ).toBe('When the pre-send checklist is complete → add a note (nothing written yet)');
  });

  it('still reads as a sentence with nothing chosen at all', () => {
    expect(describeAutomation({})).toBe('When something happens → do nothing yet');
  });

  // A rule written by a newer version of the app must still be recognisable
  // rather than rendering as a blank row.
  it('names an unrecognised trigger and action instead of hiding them', () => {
    expect(describeAutomation({ trigger: 'po_exploded', action: 'launch_rocket' })).toBe(
      'When “po_exploded” happens → do “launch_rocket”',
    );
  });

  it('falls back to the raw value for an unknown status or recipient', () => {
    expect(
      describeAutomation({
        trigger: 'po_status_changed',
        triggerConfig: { to: 'teleported' },
        action: 'notify',
        actionConfig: { recipients: ['warehouse'] },
      }),
    ).toBe('When a purchase order moves to teleported → notify warehouse');
  });

  it('ignores non-string recipients rather than printing them', () => {
    expect(
      describeAutomation({
        trigger: 'po_checklist_complete',
        action: 'notify',
        actionConfig: { recipients: ['admin', 7, '', null] },
      }),
    ).toBe('When the pre-send checklist is complete → notify the admins');
  });

  it('tolerates a recipients value that is not a list', () => {
    expect(
      describeAutomation({
        trigger: 'po_checklist_complete',
        action: 'notify',
        actionConfig: { recipients: 'admin' },
      }),
    ).toBe('When the pre-send checklist is complete → notify nobody yet');
  });
});

describe('AutomationsSettings', () => {
  it('renders one plain-English sentence per rule', async () => {
    renderPanel(true, [
      rule(),
      rule({
        id: 'rule-2',
        name: 'Chase production',
        trigger: 'po_status_changed',
        triggerConfig: { to: 'in_production' },
        action: 'notify',
        actionConfig: { recipients: ['admin'] },
      }),
    ]);

    expect(await screen.findByText('Test print to QC')).toBeInTheDocument();
    expect(getJson).toHaveBeenCalledWith('/api/admin/automations', 'Failed to load automations');
    expect(screen.getByTestId('rule-sentence-rule-1')).toHaveTextContent(
      'When a Test print is uploaded to a purchase order → move the purchase order to Quality control',
    );
    expect(screen.getByTestId('rule-sentence-rule-2')).toHaveTextContent(
      'When a purchase order moves to Production → notify the admins',
    );
  });

  it('marks a paused rule and shows its switch off', async () => {
    renderPanel(true, [rule({ isActive: false })]);

    expect(await screen.findByText('paused')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'In use: Test print to QC' })).not.toBeChecked();
  });

  it('is read-only for a non-admin: no add, no edit, switch disabled', async () => {
    renderPanel(false, [rule()]);

    await screen.findByText('Test print to QC');
    expect(screen.queryByRole('button', { name: /add automation/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'In use: Test print to QC' })).toBeDisabled();
  });

  it('pausing a rule PATCHes it by id and re-renders from the response', async () => {
    const user = userEvent.setup();
    renderPanel(true, [rule()]);
    await screen.findByText('Test print to QC');

    vi.mocked(patchJson).mockResolvedValueOnce(rule({ isActive: false }));
    await user.click(screen.getByRole('switch', { name: 'In use: Test print to QC' }));

    await vi.waitFor(() =>
      expect(patchJson).toHaveBeenCalledWith(
        '/api/admin/automations',
        { id: 'rule-1', isActive: false },
        'Failed to save the automation',
      ),
    );
    expect(await screen.findByText('paused')).toBeInTheDocument();
  });

  it('creates a rule through the modal with the trigger/action config shape', async () => {
    const user = userEvent.setup();
    renderPanel(true, []);
    await vi.waitFor(() => expect(getJson).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: /add automation/i }));
    const dialog = await screen.findByRole('dialog');
    await user.type(
      within(dialog).getByPlaceholderText('e.g. Test print goes to quality control'),
      'Chase production',
    );

    // Trigger defaults to the status trigger, so only its status is needed.
    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: 'Status reached' }));
    fireEvent.click(await screen.findByTitle('Production'));
    // Action defaults to notify.
    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: 'Notify' }));
    fireEvent.click(await screen.findByTitle('the admins'));

    vi.mocked(getJson).mockResolvedValueOnce({ items: [] });
    await user.click(within(dialog).getByRole('button', { name: 'Add automation' }));

    await vi.waitFor(() =>
      expect(postJson).toHaveBeenCalledWith(
        '/api/admin/automations',
        {
          name: 'Chase production',
          trigger: 'po_status_changed',
          triggerConfig: { to: 'in_production' },
          action: 'notify',
          actionConfig: { recipients: ['admin'] },
          isActive: true,
        },
        'Failed to add the automation',
      ),
    );
  });

  /**
   * The skipped-check condition (David, 2026-08-07). Saved as a present key
   * only when it is on — an absent key means "always", so a rule written before
   * this option existed must keep matching every move.
   */
  it('saves the skipped-check condition only when it is switched on', async () => {
    const user = userEvent.setup();
    renderPanel(true, []);
    await vi.waitFor(() => expect(getJson).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: /add automation/i }));
    const dialog = await screen.findByRole('dialog');
    await user.type(
      within(dialog).getByPlaceholderText('e.g. Test print goes to quality control'),
      'Check the skipped ones',
    );
    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: 'Status reached' }));
    fireEvent.click(await screen.findByTitle('Production'));
    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: 'Notify' }));
    fireEvent.click(await screen.findByTitle('the admins'));

    await user.click(within(dialog).getByLabelText('Only when a check was skipped'));

    // The sentence updates before it is saved, which is the point of the panel.
    expect(within(dialog).getByTestId('automation-preview')).toHaveTextContent(
      'with a check that was skipped rather than done',
    );

    vi.mocked(getJson).mockResolvedValueOnce({ items: [] });
    await user.click(within(dialog).getByRole('button', { name: 'Add automation' }));

    await vi.waitFor(() =>
      expect(postJson).toHaveBeenCalledWith(
        '/api/admin/automations',
        expect.objectContaining({
          triggerConfig: { to: 'in_production', sidestepped: 'yes' },
        }),
        'Failed to add the automation',
      ),
    );
  });

  it('shows the sentence it is about to save as the rule is written', async () => {
    const user = userEvent.setup();
    renderPanel(true, []);
    await vi.waitFor(() => expect(getJson).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: /add automation/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('automation-preview')).toHaveTextContent(
      'When a purchase order changes status → notify nobody yet',
    );

    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: 'Status reached' }));
    fireEvent.click(await screen.findByTitle('Shipping'));

    await vi.waitFor(() =>
      expect(within(dialog).getByTestId('automation-preview')).toHaveTextContent(
        'When a purchase order moves to Shipping → notify nobody yet',
      ),
    );
  });

  // The second field belongs to the trigger — showing a file category under a
  // status trigger would offer a condition that can never match.
  it('swaps the condition field when the trigger changes', async () => {
    const user = userEvent.setup();
    renderPanel(true, []);
    await vi.waitFor(() => expect(getJson).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: /add automation/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('combobox', { name: 'Status reached' })).toBeInTheDocument();

    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: 'When' }));
    fireEvent.click(await screen.findByTitle('A file is uploaded to a purchase order'));

    await vi.waitFor(() =>
      expect(within(dialog).getByRole('combobox', { name: 'File category' })).toBeInTheDocument(),
    );
    expect(
      within(dialog).queryByRole('combobox', { name: 'Status reached' }),
    ).not.toBeInTheDocument();
    expect(within(dialog).getByTestId('automation-preview')).toHaveTextContent(
      'When any file is uploaded to a purchase order → notify nobody yet',
    );
  });

  it('opens an existing rule with its config filled in and PATCHes the edit', async () => {
    const user = userEvent.setup();
    renderPanel(true, [rule()]);
    await screen.findByText('Test print to QC');

    await user.click(screen.getByRole('button', { name: /edit/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('automation-preview')).toHaveTextContent(
      'When a Test print is uploaded to a purchase order → move the purchase order to Quality control',
    );

    vi.mocked(getJson).mockResolvedValueOnce({ items: [rule({ name: 'Test print to QC v2' })] });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await vi.waitFor(() =>
      expect(patchJson).toHaveBeenCalledWith(
        '/api/admin/automations',
        {
          id: 'rule-1',
          name: 'Test print to QC',
          trigger: 'po_file_uploaded',
          triggerConfig: { category: 'Test print' },
          action: 'set_status',
          actionConfig: { status: 'quality_control' },
        },
        'Failed to save the automation',
      ),
    );
  });

  it('survives a failed load with an empty table rather than a crash', async () => {
    vi.mocked(getJson).mockRejectedValueOnce(new Error('boom'));
    render(
      <AntdApp>
        <AutomationsSettings canMutate />
      </AntdApp>,
    );

    expect(await screen.findByText('boom')).toBeInTheDocument();
    expect(await screen.findByText('No automations yet.')).toBeInTheDocument();
  });
});
