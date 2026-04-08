import { configDefaults, defineConfig } from 'vitest/config';
import path from 'path';
import { vitestE2eTlsEnv } from './tests/e2e/setup/vitestTlsEnv';

const sharedResolve = {
  alias: {
    '@anupheaus/socket-api/server': path.resolve(__dirname, '../socket-api/src/server'),
    '@anupheaus/socket-api/client': path.resolve(__dirname, '../socket-api/src/client'),
    '@anupheaus/socket-api/common': path.resolve(__dirname, '../socket-api/src/common'),
    '@anupheaus/common': path.resolve(__dirname, '../common/src'),
    '@anupheaus/react-ui': path.resolve(__dirname, '../react-ui/src'),
    react: path.resolve(__dirname, 'node_modules/react'),
    'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
  },
};

/**
 * One Vitest config for all browser e2e tests. Modes:
 *   --mode crud        CRUD e2e tests (`tests/e2e/crud-operations/**\/*.crud.e2e.tests.ts`)
 *   --mode performance Performance e2e tests (`tests/e2e/crud-operations/performance.e2e.tests.ts`)
 *   --mode stress      Stress tests (`tests/e2e/stress/**\/*.tests.ts`)
 *
 * Forked workers read NODE_OPTIONS at startup (TLS preload + trust e2e CA).
 */
export default defineConfig(({ mode }) => {
  const isCrud = mode === 'crud';
  const isPerformance = mode === 'performance';
  const isStress = mode === 'stress';

  const crudInclude = ['tests/e2e/crud-operations/**/*.crud.e2e.tests.ts'];
  const performanceInclude = ['tests/e2e/crud-operations/performance.e2e.tests.ts'];
  const stressInclude = ['tests/e2e/stress/**/*.tests.ts'];

  const crudExclude = [...configDefaults.exclude, 'tests/**/*.unit.tests.ts', 'tests/**/*.unit.tests.tsx'];
  const performanceExclude = [...configDefaults.exclude, 'tests/**/*.unit.tests.ts', 'tests/**/*.unit.tests.tsx'];
  const stressExclude = [...configDefaults.exclude, 'tests/e2e/stress/**/*.unit.tests.ts', 'tests/e2e/stress/**/*.unit.tests.tsx'];

  const include = isCrud ? crudInclude : isPerformance ? performanceInclude : stressInclude;
  const exclude = isCrud ? crudExclude : isPerformance ? performanceExclude : stressExclude;
  const testTimeout = isStress ? 300_000 : 120_000;

  return {
    resolve: sharedResolve,
    test: {
      env: vitestE2eTlsEnv(__dirname),
      pool: 'forks',
      environment: 'jsdom',
      environmentOptions: {
        jsdom: {
          url: 'https://localhost',
        },
      },
      include,
      exclude,
      testTimeout,
      globals: true,
      setupFiles: ['./tests/e2e/setup/e2eVitestSetup.ts', './tests/e2e/setup/vitestGlobals.ts'],
      dangerouslyIgnoreUnhandledErrors: true,
    },
  };
});
