import { defineConfig } from 'vitest/config';
import path from 'path';
import fs from 'fs';

const localAlias = (relDir: string, ...parts: string[]) => {
  const resolved = path.resolve(__dirname, relDir);
  return fs.existsSync(resolved) ? path.resolve(resolved, ...parts) : undefined;
};

const alias: Record<string, string> = {
  // One React instance for react-dom + linked react-ui (avoids invalid hook calls in tests).
  react: path.resolve(__dirname, 'node_modules/react'),
  'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
};

const socketApiSrc = localAlias('../socket-api/src');
if (socketApiSrc) {
  alias['@anupheaus/socket-api/server'] = path.join(socketApiSrc, 'server');
  alias['@anupheaus/socket-api/client'] = path.join(socketApiSrc, 'client');
  alias['@anupheaus/socket-api/common'] = path.join(socketApiSrc, 'common');
}
const commonSrc = localAlias('../common/src');
if (commonSrc) alias['@anupheaus/common'] = commonSrc;
const reactUiSrc = localAlias('../react-ui/src');
if (reactUiSrc) alias['@anupheaus/react-ui'] = reactUiSrc;

export default defineConfig({
  resolve: { alias },
  test: {
    environment: 'node',
    include: [
      'src/**/*.tests.ts',
      'src/**/*.tests.tsx',
      '*.unit.tests.ts',
      '*.unit.tests.tsx',
      '**/*.unit.tests.ts',
      '**/*.unit.tests.tsx',
    ],
    globals: true,
    setupFiles: ['./tests/e2e/setup/e2eVitestSetup.ts', './tests/e2e/setup/vitestGlobals.ts'],
    //setupFiles: ['./vitest.setup.ts'],
  },
});
