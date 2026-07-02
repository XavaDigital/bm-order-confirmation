import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    globals: false,
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/**/*.integration.test.ts',
        'src/db/test-helpers.ts',
        'src/db/migrations/**',
      ],
    },
    // Two projects sharing plugins/coverage config: node-environment API/service
    // tests (fast, PGlite-backed) and jsdom-environment component tests (React
    // Testing Library). Kept separate so component-test setup (jest-dom matchers,
    // RTL cleanup) never leaks into the node project or slows it down.
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          setupFiles: ['./vitest.setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
          setupFiles: ['./vitest.setup.ts', './vitest.setup.dom.ts'],
        },
      },
    ],
  },
});
