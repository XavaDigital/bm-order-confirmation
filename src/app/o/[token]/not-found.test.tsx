import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import TokenNotFound from './not-found';

describe('TokenNotFound', () => {
  it('renders a generic "link not found" message without revealing why', () => {
    render(<TokenNotFound />);

    expect(screen.getByText('Link Not Found')).toBeInTheDocument();
    expect(screen.getByText(/no longer valid or has expired/i)).toBeInTheDocument();
  });
});
