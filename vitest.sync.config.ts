import { defineConfig } from 'vitest/config';
import path from 'path';
import { vitestSyncTestTlsEnv } from './tests/sync-test/vitestTlsEnv';

export default defineConfig({
  resolve: {
    alias: {
      '@anupheaus/socket-api/server': path.resolve(__dirname, '../socket-api/src/server'),
      '@anupheaus/socket-api/client': path.resolve(__dirname, '../socket-api/src/client'),
      '@anupheaus/socket-api/common': path.resolve(__dirname, '../socket-api/src/common'),
      '@anupheaus/common': path.resolve(__dirname, '../common/src'),
      '@anupheaus/react-ui': path.resolve(__dirname, '../react-ui/src'),
      'react': path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
    },
  },
  test: {
    env: vitestSyncTestTlsEnv(__dirname),
    // Forked workers read NODE_OPTIONS at startup (TLS preload + trust sync-test CA).
    pool: 'forks',
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        url: 'https://localhost',
      },
    },
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
