import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuthCard } from './AuthCard';

describe('AuthCard', () => {
  it('renders its children inside the themed card shell', () => {
    render(
      <AuthCard>
        <div>Sign in form goes here</div>
      </AuthCard>,
    );

    expect(screen.getByText('Sign in form goes here')).toBeInTheDocument();
  });

  it('defaults to a 400px max width and accepts an override', () => {
    const { container, rerender } = render(
      <AuthCard>
        <div>content</div>
      </AuthCard>,
    );
    const card = container.querySelector('div > div > div') as HTMLElement;
    expect(card.style.maxWidth).toBe('400px');

    rerender(
      <AuthCard maxWidth={480}>
        <div>content</div>
      </AuthCard>,
    );
    const resizedCard = container.querySelector('div > div > div') as HTMLElement;
    expect(resizedCard.style.maxWidth).toBe('480px');
  });
});
