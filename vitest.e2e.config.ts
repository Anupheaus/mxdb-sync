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
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
    },
  },
  test: {
    env: vitestSyncTestTlsEnv(__dirname),
    pool: 'forks',
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        url: 'https://localhost',
      },
    },
    include: ['tests/e2e/**/*.test.ts', 'tests/e2e/**/*.test.tsx'],
    testTimeout: 120_000,
    globals: true,
    setupFiles: ['./tests/e2e/setup/e2eVitestSetup.ts', './tests/e2e/setup/vitestGlobals.ts'],
    dangerouslyIgnoreUnhandledErrors: true,
  },
});
