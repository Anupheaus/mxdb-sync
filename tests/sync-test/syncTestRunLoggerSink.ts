import type { RunLogger } from './runLogger';

let current: RunLogger | undefined;

/** Wired in integration `beforeAll` / cleared in `afterAll` so the mocked `Logger` can append `app_logger` lines. */
export function setSyncTestRunLogger(logger: RunLogger | undefined): void {
  current = logger;
}

export function getSyncTestRunLogger(): RunLogger | undefined {
  return current;
}
