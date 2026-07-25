import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

// jsdom doesn't implement these; antd's responsive/layout components use them.
// Emulate a 1280px-wide desktop viewport so Grid.useBreakpoint reports
// md/lg/xl true and components render their desktop layouts in tests.
const VIEWPORT_WIDTH = 1280;
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = vi.fn().mockImplementation((query: string) => {
    const min = query.match(/min-width:\s*([\d.]+)px/);
    const max = query.match(/max-width:\s*([\d.]+)px/);
    let matches = Boolean(min || max);
    if (min) matches = matches && VIEWPORT_WIDTH >= parseFloat(min[1]);
    if (max) matches = matches && VIEWPORT_WIDTH <= parseFloat(max[1]);
    return {
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };
  });
}

if (typeof window.ResizeObserver !== 'function') {
  window.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
