/**
 * Constants for the sync integration test.
 * 50 clients, ~30s run, random delays 0.5–1s, server restart at ~15s.
 */
export const NUM_CLIENTS = 50;
export const TEST_DURATION_MS = 30_000;
export const DELAY_MIN_MS = 500;
export const DELAY_MAX_MS = 1000;
export const SERVER_RESTART_AT_MS = 15_000;
export const SERVER_RESTART_WAIT_MS = 1000;
export const COLLECTION_NAME = 'syncTest';
export const DEFAULT_PORT = 0; // 0 = let OS choose free port
export const CLIENT_CONNECT_TIMEOUT_MS = 10_000;
export const SHUTDOWN_DRAIN_MS = 2000;
export const FINAL_SYNC_GRACE_MS = 10_000;
export const QUIET_PERIOD_STABLE_MS = 2000;
export const QUIET_PERIOD_TIMEOUT_MS = 60_000;
