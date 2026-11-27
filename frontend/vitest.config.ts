import { defineConfig } from 'vitest/config';

// Node tests for the pure chart foundation (finance formatter, option
// builders, catalog/guardrail re-exports). No jsdom needed — options are
// plain records and the modules under test never touch the DOM.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts'],
    reporters: 'default',
  },
});
