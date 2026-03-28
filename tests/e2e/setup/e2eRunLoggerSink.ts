import type { RunLogger } from '../../sync-test/runLogger';

let current: RunLogger | undefined;

/** Set from {@link setupE2E} so the mocked `Logger` and client harness can append lines. */
export function setE2eRunLogger(logger: RunLogger | undefined): void {
  current = logger;
}

export function getE2eRunLogger(): RunLogger | undefined {
  return current;
}
