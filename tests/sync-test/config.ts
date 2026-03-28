/**
 * Constants for the sync integration test.
 * Integrity oracle is each client’s local DB after idle (`expectedStateFromClients`), not the op log.
 * Integration test: random create/update mix until {@link TEST_DURATION_MS} elapses; max distinct rows {@link SYNC_TEST_INTEGRATION_MAX_RECORDS}.
 */
export const NUM_CLIENTS = 50;

/** Max distinct `syncTest` rows the integration test will hold at once (create blocked while this many ids are live). */
export const SYNC_TEST_INTEGRATION_MAX_RECORDS = 20;
/**
 * Max successful removes in one run: half of {@link SYNC_TEST_INTEGRATION_MAX_RECORDS} (floor).
 * Each iteration only *attempts* a delete with {@link SYNC_TEST_INTEGRATION_DELETE_ROLL_CHANCE}.
 */
export const SYNC_TEST_INTEGRATION_DELETE_ROLL_CHANCE = 0.08;
/** Wall-clock window for the integration workload (create/update loop after subscribe setup). */
export const TEST_DURATION_MS = 40_000;
export const DELAY_MIN_MS = 500;
export const DELAY_MAX_MS = 1000;
/** Mid-workload server process restart: `0` disables. Clients reconnect and resync on the same port. */
export const SERVER_RESTART_AT_MS = 15_000;
/** After server child process has exited, wait this long before spawning the replacement (e.g. port / TIME_WAIT). */
export const SERVER_RESTART_WAIT_MS = 1000;
export const COLLECTION_NAME = 'syncTest';
export const DEFAULT_PORT = 0; // 0 = let OS choose free port
/** Random pause between harness CRUD calls (sequential + future workloads); uniform in [min, max). */
export const CRUD_GAP_MIN_MS = 100;
export const CRUD_GAP_MAX_MS = 500;

export const CLIENT_CONNECT_TIMEOUT_MS = 10_000;
export const SHUTDOWN_DRAIN_MS = 2000;
export const FINAL_SYNC_GRACE_MS = 10_000;
export const QUIET_PERIOD_STABLE_MS = 3000;
export const QUIET_PERIOD_TIMEOUT_MS = 60_000;
