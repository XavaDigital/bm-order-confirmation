import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OrderStatusBadge } from './OrderStatusBadge';

describe('OrderStatusBadge', () => {
  it.each([
    ['draft', 'Draft'],
    ['sent', 'Sent'],
    ['viewed', 'Viewed'],
    ['confirmed', 'Confirmed'],
    ['changes_requested', 'Changes Requested'],
    ['cancelled', 'Cancelled'],
  ])('renders the %s status with label "%s"', (status, label) => {
    render(<OrderStatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('falls back to the raw status string for an unrecognized status', () => {
    render(<OrderStatusBadge status="some_future_status" />);
    expect(screen.getByText('some_future_status')).toBeInTheDocument();
  });
});
