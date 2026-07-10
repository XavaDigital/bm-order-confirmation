import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShippingAddressField } from './ShippingAddressField';

describe('ShippingAddressField', () => {
  it('mode "later" shows an info alert and no form fields', () => {
    render(<ShippingAddressField mode="later" />);

    expect(
      screen.getByText(/shipping address will be confirmed separately/i),
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('123 Main Street')).not.toBeInTheDocument();
  });

  it('mode "prefilled" renders the read-only address when provided', () => {
    render(
      <ShippingAddressField
        mode="prefilled"
        prefilledAddress={{
          line1: '123 Main Street',
          city: 'Auckland',
          postcode: '1010',
          country: 'New Zealand',
        }}
      />,
    );

    expect(screen.getByText(/123 Main Street/)).toBeInTheDocument();
    expect(screen.getByText(/Auckland/)).toBeInTheDocument();
    expect(screen.getByText(/New Zealand/)).toBeInTheDocument();
  });

  it('mode "prefilled" shows a fallback message when no address is set', () => {
    render(<ShippingAddressField mode="prefilled" prefilledAddress={null} />);

    expect(screen.getByText('No address provided')).toBeInTheDocument();
  });

  it('mode "customer_entered" renders editable fields and reports changes via onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ShippingAddressField mode="customer_entered" onChange={onChange} />);

    await user.type(screen.getByPlaceholderText('123 Main Street'), 'Line 1');
    await user.type(screen.getByLabelText('City'), 'City');

    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(lastCall).toMatchObject({ line1: 'Line 1', city: 'City' });
  });
});
