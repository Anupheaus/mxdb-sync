import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@anupheaus/socket-api/server': path.resolve(__dirname, '../socket-api/src/server'),
      '@anupheaus/socket-api/client': path.resolve(__dirname, '../socket-api/src/client'),
      '@anupheaus/socket-api/common': path.resolve(__dirname, '../socket-api/src/common'),
      '@anupheaus/common': path.resolve(__dirname, '../common/src'),
      '@anupheaus/react-ui': path.resolve(__dirname, '../react-ui/src'),
      // One React instance for react-dom + linked react-ui (avoids invalid hook calls in tests).
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
  },
});
