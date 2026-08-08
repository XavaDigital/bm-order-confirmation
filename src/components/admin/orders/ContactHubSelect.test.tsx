/**
 * Picking the CRM contact who placed the order.
 *
 * The behaviour worth pinning is the automatic one (David, 2026-08-09: "when a
 * Customer is chosen, which only has a single Contact, the contact should be
 * automatically selected"): it has to fire when there is genuinely no choice,
 * and it must not fight someone who deliberately clears the field.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App as AntdApp } from 'antd';
import { installMockFetch, type MockRoute } from '@/test/mockFetch';
import { ContactHubSelect, type HubContactPick } from './ContactHubSelect';

const CUSTOMER_ID = 'cus-1';
const CONTACTS_URL = `/api/admin/hub/customers/${CUSTOMER_ID}/contacts`;

function contactsRoute(contacts: HubContactPick[]): MockRoute {
  return { match: CONTACTS_URL, method: 'GET', response: { contacts } };
}

function renderSelect(
  props: Partial<React.ComponentProps<typeof ContactHubSelect>> = {},
) {
  const onSelect = vi.fn();
  render(
    <AntdApp>
      <ContactHubSelect
        customerId={CUSTOMER_ID}
        value={null}
        onSelect={onSelect}
        {...props}
      />
    </AntdApp>,
  );
  return { onSelect };
}

beforeEach(() => {
  installMockFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ContactHubSelect — a customer with one contact', () => {
  it('selects that contact without being asked', async () => {
    installMockFetch([contactsRoute([{ id: 'con-1', name: 'Jane Coach', email: 'jane@club.nz' }])]);
    const { onSelect } = renderSelect();

    await vi.waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith({
        id: 'con-1',
        name: 'Jane Coach',
        email: 'jane@club.nz',
      }),
    );
  });

  // Two contacts IS a choice, and it is not ours to make.
  it('selects nothing when the customer has more than one', async () => {
    installMockFetch([
      contactsRoute([
        { id: 'con-1', name: 'Jane Coach' },
        { id: 'con-2', name: 'Sam Manager' },
      ]),
    ]);
    const { onSelect } = renderSelect();

    await screen.findByText('Contact (who placed the order)');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('selects nothing when the customer has no contacts', async () => {
    installMockFetch([contactsRoute([])]);
    const { onSelect } = renderSelect();

    await screen.findByText('Contact (who placed the order)');
    expect(onSelect).not.toHaveBeenCalled();
  });

  // Someone already chose — an automatic pick must not overwrite a decision.
  it('leaves an existing selection alone', async () => {
    installMockFetch([contactsRoute([{ id: 'con-1', name: 'Jane Coach' }])]);
    const { onSelect } = renderSelect({
      value: { id: 'con-9', name: 'Someone Else' },
    });

    await screen.findByText('Contact (who placed the order)');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('renders nothing at all until a customer is chosen', () => {
    const { onSelect } = renderSelect({ customerId: null });

    expect(screen.queryByText('Contact (who placed the order)')).not.toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  // An unreachable or unconfigured hub leaves an empty picker, not a crash.
  it('stays quiet when the contacts cannot be loaded', async () => {
    installMockFetch([{ match: CONTACTS_URL, method: 'GET', status: 500, response: {} }]);
    const { onSelect } = renderSelect();

    await screen.findByText('Contact (who placed the order)');
    expect(onSelect).not.toHaveBeenCalled();
  });
});
