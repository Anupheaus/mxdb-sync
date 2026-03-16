# Client Sync Integrity Test — Plan (tests/sync-test)

This document is the updated plan for the sync integration test. It reflects:

- **Server storage**: Option A (MongoDB Memory Server)
- **Location**: `tests/sync-test/` with a dedicated npm script (e.g. `test:sync`)
- **Client storage**: **fake-indexeddb** — real `Db` and `DbCollection` run in Node with in-memory IndexedDB (no custom mock store).
- **Client usage**: **Real React client tools** — each client is a real React tree (MXDBSync: SocketAPI, DbsProvider, SyncProvider, ClientToServerProvider, ServerToClientProvider). Drive via the same APIs the app uses (`useCollection`, etc.). No harness that replicates provider logic; we run the actual components. See “React client usage” below.
- **Server restart** mid-session (~15s)
- **Single log file** per run, nanosecond timestamps, for traceability on failure
- **Focus**: Data integrity (performance out of scope)
- **Code split** across multiple files in `tests/sync-test/`

---

## Goal

- 50 clients with local state on a single server (MongoDB Memory Server), all syncing the same collection.
- Clients make updates while disconnected or delayed; changes are recorded locally and synced when reconnected.
- ~30 seconds of activity with random disconnects (0.5–1s) and delays (0.5–1s).
- Server restart once in the middle so clients must survive and resync.
- One log file per run with nanosecond-precision timestamps.
- Records of truth to derive expected state; compare with server state for integrity.

---

## Client storage: fake-indexeddb

- Use the **fake-indexeddb** npm package so the **real** `Db` and `DbCollection` run in Node with an in-memory IndexedDB API.
- In test setup (before any client code), run `import 'fake-indexeddb/auto'` so `indexedDB` and related globals are available. Ensure the client’s `window.indexedDB` / `self.indexedDB` point to this (e.g. Vitest setup file or global patch).
- No custom mock store: storage and audit logic are the real codebase `Db` + `DbCollection`.

---

## React client usage: real React only (as close to production as possible)

- We use the **real** React client stack with **no** mocking of provider or hook behavior. Each of the 50 clients is a full React root with the same stack as the app:
  - **MXDBSync** (or equivalent): SocketAPI, DbsProvider, SyncProvider, ClientToServerProvider, ServerToClientProvider.
  - **SyncProvider**: on socket connect, runs `synchroniseCollections(db, collections, syncCollections)` (real `synchronise-collections.ts`).
  - **ClientToServerProvider**: subscribes to `dbCollection.onChange`, calls `mxdbUpsertAction` / `mxdbRemoveAction` when connected.
  - **ServerToClientProvider**: handles `mxdbServerPush`, applies updates to the real `DbCollection`.
- **Execution**: Use **jsdom** so React and DOM globals exist. Render **50 React roots**, each with the full client stack. Each root has its own Db (fake-indexeddb, unique DB name per client) and its own socket connection. Drive each client by having a component inside the tree that receives a “script” of operations (or ref/callback) and calls `useCollection(collection).upsert(record)` (and disconnect/reconnect via socket or useMXDBSync) at the right times — the same API the real app would use.
- This keeps the test as close to real as possible: real React, real providers, real hooks, real Db/DbCollection (fake-indexeddb).

---

## File layout

```
tests/sync-test/
├── logs/                          # .gitignore: logs from runs
├── config.ts                      # NUM_CLIENTS, TEST_DURATION_MS, DELAY_MIN_MS, DELAY_MAX_MS, SERVER_RESTART_AT_MS, COLLECTION_NAME, PORT
├── types.ts                       # SyncTestRecord, RecordOfTruth, ClientEvent, etc.
├── runLogger.ts                   # Create logs/sync-test-<timestamp>.log; log(eventName, detail?) with nano timestamp
├── serverLifecycle.ts             # startMongo(), startServer() → { server, stop }, restartServer()
├── syncClient.ts                  # Sync client: real React root (MXDBSync stack) + real Db/DbCollection (fake-indexeddb), driver component calls useCollection().upsert(), connect/disconnect
├── recordsOfTruth.ts              # addUpdate(clientId, timestampNs, record), getExpectedState() (last-write-wins), clear
├── integrityAssertions.ts         # assertIntegrity(serverRecords, expectedState, runLogger)
└── clientSync.integration.test.ts # Main test: setup, 30s loop, server restart at midpoint, shutdown, assert integrity
```

---

## Test flow

1. **Setup**: Create run logger (new log file with run timestamp). Start MongoDB Memory Server. Start server on port from config. Create 50 sync clients, connect each, wait until all connected. Clear records of truth.

2. **Loop (30s)**  
   Per client (concurrent):
   - Random delay 0.5–1s.
   - Either:
     - **Update**: Generate record, call `client.upsert(record)` (local + send if connected). Append to records of truth with clientId and nanosecond timestamp. Log.
     - **Disconnect**: `client.disconnect()`, wait 0.5–1s, make an update while disconnected (`client.upsert(record)` — local only), then `client.connect()`, wait connected; sync runs on connect. Log.
   - **Mid-session (e.g. ~15s)**: Once, restart server (stop, wait ~1s, start again same port). All clients disconnect; they reconnect and sync. Log server restart.

3. **Shutdown**: After 30s, stop new work; wait for in-flight syncs/upserts. Disconnect all clients. Stop server.

4. **Integrity**: Read server collection (Mongo client vs memory server URI, or test-only getAll). Compute expected state from records of truth. Call `assertIntegrity(serverRecords, expectedState, runLogger)`.

---

## Logging

- One log file per test run; filename includes run timestamp (e.g. `sync-test-2025-03-11T12-30-45.123Z.log`).
- Every notable event with nanosecond-precision timestamp (`process.hrtime.bigint()` for ordering; optional ISO string for readability).
- Events: test start/end, server start/stop/restart, client connect/disconnect, client update (clientId, record id, timestamp), sync request/response, errors.
- Location: `tests/sync-test/logs/` (add to `.gitignore` if desired).

---

## Package.json and Vitest

- **Script**: `"test:sync": "vitest run --config vitest.sync.config.ts"` (or equivalent).
- **vitest.sync.config.ts**: `include: ['tests/sync-test/**/*.test.ts']`, `testTimeout: 60000`, **`environment: 'jsdom'`** so React, hooks, and DOM are available for the real client stack.
- **DevDependencies**: `mongodb-memory-server`, `fake-indexeddb`. jsdom is typically provided by Vitest when `environment: 'jsdom'` is set.

---

## Sync client (syncClient.ts)

- **Storage**: Real `Db` + `DbCollection` from the codebase, backed by **fake-indexeddb** (one DB per client, unique name). No custom in-memory store.
- **React stack**: Each client is a **real React root** with the full MXDBSync stack (SocketAPI, DbsProvider, SyncProvider, ClientToServerProvider, ServerToClientProvider). Sync and action flow are the real components and hooks — no harness that replicates their logic.
- **Driver**: A component inside each client’s tree (or a ref/callback from the test) receives operations and calls `useCollection(collection).upsert(record)` and socket disconnect/reconnect (e.g. via `useMXDBSync` or SocketAPI) so the test drives the client through the same APIs the app uses.
- `connect()` / `disconnect()`: control the socket (or trigger reconnection) so that SyncProvider runs sync on connect.
- `upsert(record)`: invoked by the driver component calling the real `useCollection(collection).upsert(record)` (or equivalent) so the real ClientToServerProvider sends to the server when connected.
- Socket and action format match @anupheaus/socket-api (real client uses it).

---

## Open points

- Socket-api protocol: real client uses @anupheaus/socket-api; no change needed, same event names and format.
- GetAll: Mongo client in test against memory server URI, or test-only action that returns all records.
- fake-indexeddb: in Vitest setup (or sync-test setup), run `import 'fake-indexeddb/auto'` before any client code so `window.indexedDB` (jsdom) is the fake.
- jsdom: sync test config uses `environment: 'jsdom'` so React and useCollection run in a DOM-like environment.
