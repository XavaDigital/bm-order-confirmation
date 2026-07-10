import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { GoogleTagManagerHead, GoogleTagManagerBody } from './GoogleTagManager';

describe('GoogleTagManagerHead', () => {
  it('renders a script tag embedding the given GTM container ID', () => {
    const { container } = render(<GoogleTagManagerHead gtmId="GTM-ABC123" />);

    const script = container.querySelector('#gtm-head');
    expect(script).toBeInTheDocument();
    expect(script?.innerHTML).toContain("'GTM-ABC123'");
  });
});

describe('GoogleTagManagerBody', () => {
  // jsdom does not render <noscript> children into the queryable DOM (same as
  // real browsers with scripting enabled), so the iframe's attributes can't be
  // asserted on directly here — this covers that the component renders without
  // throwing, which is what the src/GoogleTagManager module actually branches on.
  it('renders a noscript element without throwing', () => {
    const { container } = render(<GoogleTagManagerBody gtmId="GTM-ABC123" />);

    expect(container.querySelector('noscript')).toBeInTheDocument();
  });
});
