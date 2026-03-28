# E2E test setup — public API

Import everything from the barrel:

```ts
import {
  installBrowserEnvironment,
  clearSyncTestCollections,
  e2eNoopRunLogger,
  e2eForwardingRunLogger,
  createE2eRunLogger,
  getE2eRunLogger,
  setE2eRunLogger,
  setupE2E,
  resetE2E,
  teardownE2E,
  useClient,
  useServer,
  waitUntilAsync,
  waitForLiveRecordAbsent,
  waitForAllClientsIdle,
  auditEntryTypesChronological,
  type E2EClientHandle,
  type E2EServerAccess,
  type SetupE2EOptions,
  type WaitForAllClientsIdleOptions,
} from './setup'; // or `tests/e2e/setup` from another file under `tests/e2e/`
```

**Vitest:** `vitest.e2e.config.ts` uses `setupFiles` in this order: `e2eVitestSetup.ts` (hoisted `vi.mock('@anupheaus/common')` for `app_logger` capture + longer action timeout, same idea as sync-test), then `vitestGlobals.ts` (`installBrowserEnvironment`). Call `setupE2E()` in `beforeAll` to start Mongo + server and open a run log file under `tests/e2e/logs/e2e-{timestamp}.log` (nanosecond lines, `server_log` / `app_logger` condensed like `tests/sync-test/runLogger.ts`). `test.env` sets TLS for forked workers (see `tests/sync-test/vitestTlsEnv.ts`). Run with `pnpm test:e2e`.

---

## Functions

### `installBrowserEnvironment(): void`

Installs browser-like globals in Node: `fake-indexeddb`, JSDOM (`window` / `document`), `self`, and a minimal `URL.createObjectURL` if missing. Idempotent (safe to call multiple times). Also sets `process.env.MXDB_DIAG_FILE` to a file under `tests/sync-test/logs/` when unset.

`setupE2E()` calls this internally; use standalone only if you need globals before `setupE2E` without Vitest `setupFiles`.

---

### `setupE2E(options?: SetupE2EOptions): Promise<void>`

**Call in `beforeAll`.** Ensures browser environment, temporarily removes `global.window` / `document` while starting infrastructure (same pattern as the sync integration test), then:

1. Creates `tests/e2e/logs/e2e-{iso}.log`, registers `setE2eRunLogger` + `setServerLogCallback` (forked server stdout/stderr → `server_log` lines).
2. Starts MongoDB Memory ReplSet (if needed) and forks the HTTPS sync server (`tests/sync-test/serverProcess.cjs` + `syncTest` collection).
3. Unless `skipInitialMongoClear` is set, clears `syncTest` and `syncTest_sync` in `mxdb-sync-test`.

`useClient` wires `createSyncClient` to `e2eForwardingRunLogger` so socket/client harness events append to the same file.

Throws if `setupE2E` was already called in this worker without `teardownE2E()`.

---

### `resetE2E(): Promise<void>`

**Call in `beforeEach` for isolated tests.** Unmounts every client created via `useClient`, closes each client DB via `dbs.close`, clears the client registry, and runs `clearSyncTestCollections` on the current Mongo URI.

After reset, the next `useClient('sameLabel')` builds a **new** React client and SQLite-backed DB (`e2e-client-{label}`).

---

### `teardownE2E(): Promise<void>`

**Call in `afterAll`.** Unmounts/closes all clients, then `stopLifecycle(true)` (stops server child + Mongo Memory Server), clears server log callback and `setE2eRunLogger(undefined)`, closes the run log stream. No-op if `setupE2E` never ran or context was already torn down.

---

### `useClient(label: string): E2EClientHandle`

**Requires `setupE2E()` to have completed.** Returns a named client; creates it on first use for that `label` in the current context. Empty `label` throws.

Internal details (useful for debugging): logging id `e2e-{label}`, DbsProvider / DB name `e2e-client-{label}`.

---

### `useServer(): E2EServerAccess`

**Requires `setupE2E()` to have completed.** Returns a fresh object each call; all methods use the active lifecycle (same Mongo URI and port).

---

### `clearSyncTestCollections(mongoUri: string): Promise<void>`

Deletes all documents in `mxdb-sync-test.syncTest` and `mxdb-sync-test.syncTest_sync`. Exported for advanced use (e.g. custom reset logic); `resetE2E` and initial `setupE2E` already use it.

---

### `waitUntilAsync(predicate, label, timeoutMs?, intervalMs?): Promise<void>`

Polls every `intervalMs` (default `50`) until `predicate()` returns a truthy promise, or throws with `Timeout waiting for: {label}` after `timeoutMs` (default `60000`).

---

### `waitForLiveRecordAbsent(recordId, timeoutMs?): Promise<void>`

Uses `useServer().readLiveRecords()` until no row has `id === recordId`. Default timeout `30000` ms. Requires active e2e context.

---

### `waitForAllClientsIdle(clients, options?): Promise<void>`

Waits until every `E2EClientHandle` in `clients` has `getIsSynchronising() === false` and `getPendingC2SSyncQueueSize() === 0` for `stableTicksRequired` consecutive polls (default `8`, `pollMs` default `100`). Default overall timeout `90000` ms. No-op when `clients` is empty.

Options: `WaitForAllClientsIdleOptions` (`timeoutMs`, `stableTicksRequired`, `pollMs`).

---

### `auditEntryTypesChronological<R>(audit): AuditEntryType[]`

Returns `AuditEntryType` values for each entry in a `ServerAuditOf<R>`, sorted by `decodeTime(entry.id)` (ULID order). Generic `R` defaults to `Record` from `@anupheaus/common`.

---

## Constants / run log helpers

### `e2eNoopRunLogger`

`{ log(event, detail?) => void }` compatible with `createSyncClient`’s run logger. For custom harnesses that call `createSyncClient` without the file log.

### `e2eForwardingRunLogger`

Forwards to `getE2eRunLogger()` when set (used by `useClient` during `setupE2E`).

### `createE2eRunLogger(): RunLogger`

Opens a new `e2e-{timestamp}.log` under `tests/e2e/logs/`. Normally you do not call this directly; `setupE2E` does.

### `getE2eRunLogger()` / `setE2eRunLogger(logger)`

Access the active file logger (used by the Vitest `Logger` mock and `e2eForwardingRunLogger`).

---

## Types

### `SetupE2EOptions`

| Field | Type | Description |
|--------|------|-------------|
| `port?` | `number` | Passed to server startup (`0` = OS-assigned; default from `tests/sync-test/config` `DEFAULT_PORT`). |
| `skipInitialMongoClear?` | `boolean` | If `true`, skip truncating `syncTest` / `syncTest_sync` right after the server is ready. |

---

### `WaitForAllClientsIdleOptions`

| Field | Type | Description |
|--------|------|-------------|
| `timeoutMs?` | `number` | Max wall time (default `90000`). |
| `stableTicksRequired?` | `number` | Consecutive idle polls before resolving (default `8`). |
| `pollMs?` | `number` | Delay between polls (default `100`). |

---

### `E2EServerAccess`

| Member | Description |
|--------|-------------|
| `mongoUri` | Mongo connection string (Memory ReplSet). |
| `port` | HTTPS server listen port. |
| `socketHost` | Host string for the client socket **without** protocol, e.g. `localhost:12345` (socket-api builds `wss://` from it). |
| `stopServer()` | Stops the forked server child only. |
| `restartServer()` | Stops child, waits, respawns on the same port; returns the new server instance (see `tests/sync-test/serverLifecycle.ts`). |
| `readLiveRecords()` | All documents in server `syncTest`, as `SyncTestRecord[]`. |
| `readAudits(liveCollectionName?)` | Map of record id → `ServerAuditOf<SyncTestRecord>` from `{liveCollectionName}_sync`; default live name is `syncTest`. |
| `clearStoredCollectionData()` | Same as `clearSyncTestCollections` for this run’s URI. |
| `waitForLiveRecord(recordId, options?)` | Polls `readLiveRecords` until `recordId` exists or throws after `timeoutMs` (default `30000`) with `intervalMs` (default `50`). Use after local writes because client-to-server sync is asynchronous. |

---

### `E2EClientHandle`

Extends **`SyncClient`** from `tests/sync-test/syncClient.tsx` with a wider `connect`:

- **`connect(host?: string): Promise<void>`** — If `host` is omitted, uses `useServer().socketHost`.

All other methods match `SyncClient`:

| Method | Description |
|--------|-------------|
| `connect(serverUrl: string)` | *(Base signature; e2e wrapper allows optional host.)* Mounts React tree and resolves when driver is ready. |
| `disconnect()` / `reconnect()` | Test hooks on the MXDB socket. |
| `get(recordId)` | Fetch via collection (not local-only). |
| `getLocal(recordId)` | Local SQLite row only. |
| `subscribeGetAll()` | Subscribe full collection snapshots from server. |
| `getGetAllSubscriptionSnapshot()` | Last get-all subscription snapshot. |
| `upsert(record)` | Local upsert + sync when connected. |
| `remove(recordId)` | Remove (queues offline if disconnected). |
| `getIsConnected()` / `getIsSynchronising()` | Connection / sync state. |
| `getLocalRecords()` | Current local rows from the active query hook. |
| `getPendingC2SSyncQueueSize()` | Deduped C2S queue size. |
| `getLocalAudit(recordId)` | Local audit for a record. |
| `unmount()` | Unmount React root and remove container. |

Record shape: **`SyncTestRecord`** from `tests/sync-test/types.ts`. Audit types on the server: **`ServerAuditOf<SyncTestRecord>`** from `src/common`.

---

## Non-exported internals

Files in this folder that are **not** re-exported from `index.ts` (implementation / Vitest only):

- `context.ts` — lifecycle state and implementations of `setupE2E` / `useClient` / `useServer`.
- `browserEnvironment.ts` — used by `installBrowserEnvironment` and `vitestGlobals.ts`.
- `utils.ts` — implementations of the exported wait/audit helpers (import via the barrel only).
- `e2eVitestSetup.ts` — Vitest `setupFiles` entry (Logger mock + action timeout); load before `vitestGlobals.ts`.
- `vitestGlobals.ts` — browser globals `setupFiles` entry.
- `e2eRunLoggerSink.ts` — backing store for the active `RunLogger` during a suite.

---

## Typical shape

```ts
beforeAll(async () => { await setupE2E(); }, 90_000);
beforeEach(async () => { await resetE2E(); });
afterAll(async () => { await teardownE2E(); }, 30_000);
```

See `tests/e2e/harness.smoke.test.ts` for a minimal example and `tests/e2e/deletions.e2e.test.ts` for usage of the wait/audit utilities.
