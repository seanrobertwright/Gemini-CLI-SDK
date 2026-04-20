import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests-live/**/*.spec.ts'],
    globals: false,
    environment: 'node',
    // Live tests make real gemini-cli subprocess calls + model inference;
    // allow generous timeout (90s) to accommodate cold-start + network + model latency.
    testTimeout: 90_000,
    hookTimeout: 30_000,
  },
});
