import path from 'path';

/**
 * `NODE_EXTRA_CA_CERTS` + `NODE_OPTIONS --require preload-tls` for Vitest workers connecting to
 * the sync-test HTTPS server (`wss://localhost`) without shell `cross-env`.
 *
 * @param projectRoot Directory that contains `tests/sync-test/` (usually `__dirname` of `vitest.*.config.ts` at repo root).
 */
export function vitestSyncTestTlsEnv(projectRoot: string): Record<string, string> {
  const preload = path.resolve(projectRoot, 'tests/sync-test/preload-tls.cjs');
  const ca = path.resolve(projectRoot, 'tests/sync-test/certs/ca.crt');
  return {
    NODE_EXTRA_CA_CERTS: ca,
    NODE_OPTIONS: `--require=${preload}`,
  };
}
