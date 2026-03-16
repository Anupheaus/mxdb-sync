import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/sync-test/**/*.test.ts'],
    // This suite includes a 30s active period plus a quiet-period settle window.
    // Allow enough time for reconnects, server restart, and final Mongo settle loop.
    testTimeout: 300000,
    globals: true,
    setupFiles: ['./tests/sync-test/setup.ts'],
    // Disconnects / restarts intentionally trigger socket errors; we log them in run logs.
    dangerouslyIgnoreUnhandledErrors: true,
  },
});
