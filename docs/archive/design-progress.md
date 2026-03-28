# Design Progress Tracker

> **Archive:** Historical implementation checklist vs [design.md](../plans/design.md). For **how to use** the library, start at [docs/README.md](../README.md).

Tracks implementation status against `design.md`. Each item references the relevant section(s).

**Status key:** ✅ Done · 🔄 Partial · ⏳ Pending (actionable now) · 🚧 Deferred (requires major new infrastructure)

---

## §1 – Executive Summary


| Item                                                                                        | Status | Notes                                                                                  |
| ------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------- |
| §1.1 In-repo auditor (own the sync semantics, no dependency on `@anupheaus/common` auditor) | ✅      | `src/auditor/` — microdiff-based diff with string paths, ULID models, hybrid anchoring |


---

## §2 – Core Data Models


| Item                                                                                              | Status | Notes                                                                |
| ------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------- |
| §2.1 `AuditEntryType`, `OperationType`, `TargetPosition` enums                                    | ✅      | `src/auditor/auditor-models.ts`                                      |
| §2.2 `AuditOf<T>`, `AuditEntry`, `AuditOperation`, `AuditBranchedEntry` (lean, no record payload) | ✅      | `src/auditor/auditor-models.ts`                                      |
| §2.3 Record hash — SHA-256, deterministic JSON, 16 hex chars, `hashRecord()`                      | ✅      | `src/auditor/auditor.ts` — async via SubtleCrypto / Node.js fallback |


---

## §3 – Hybrid Path Anchoring


| Item                                                                             | Status | Notes                                                         |
| -------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------- |
| §3.1 Boxed-ID anchoring (`[id:abc]`, `[_id:abc]`) in diff and replay             | ✅      | `src/auditor/auditor.ts` — `diffIdArray`, `resolveArrayIndex` |
| §3.2 Hash-anchored numeric indexing (FNV-1a 64-bit, 16 hex) for anonymous arrays | ✅      | `src/auditor/auditor.ts` — `diffAnonArray`, `contentHash`     |
| §3.3 Move + `First`/`Last` position intent (no fragile numeric destination)      | ✅      | `AuditOperation.position`, `applyOp` handles `TargetPosition` |


---

## §4 – Storage Architecture


| Item                                                                                   | Status | Notes                                                                                                                                         |
| -------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| §4.1 Dual-collection strategy (live + audit)                                           | ✅      | Existing MongoDB + IndexedDB structure unchanged                                                                                              |
| §4.2 Write atomicity — MongoDB transactions wrapping live + audit writes               | ✅      | `ServerDbCollection.sync()` uses `session.withTransaction()`                                                                                  |
| §4.3 Client storage — SQLite + OPFS + AES-GCM at rest (replaces IndexedDB)             | ✅      | `@sqlite.org/sqlite-wasm` with OPFS (falls back to in-memory in tests/Node.js). Dedicated + SharedWorker (`sqlite-worker.ts`, `sqlite-shared-worker.ts`). `filtersToSql` + `sortsToSql` translators. Expression indexes from `MXDBCollectionIndex`. `SqliteWorkerClient` with inline-runner fallback for tests. **§4.3 Encryption**: AES-GCM 256-bit per-database key derived via WebAuthn PRF (`deriveEncryptionKey`). When a key is present the worker keeps the DB in memory, serialises with `sqlite3_js_db_export`, encrypts with a fresh random IV, and writes `[12-byte IV | ciphertext]` to `${dbName}.enc` in OPFS after every write transaction. On open the blob is decrypted and loaded back with `sqlite3_deserialize`. All normal SQLite indexes are preserved. Falls back to plain `OpfsDb` if PRF is unavailable. |
| §4.4 Invitation & device linking — WebAuthn, invite URL, token rotation, rate limiting | ✅      | Server: `AuthCollection`, `TokenRotation` (two-phase: `rotateBeforeAck` + `completeRotation`), `RateLimiter` (in-memory, 5/15m), `InviteNamespace` (`/{name}/register` socket.io namespace for token exchange), `createInviteLink`, `getDevices`, `enableDevice`, `disableDevice`. Client: `IndexedDbBridge` (reads IDB on mount, provides `connectionToken`+`connectionRequestId` to socket auth, renders `DbsProvider` with random `dbName`), `SqliteTokenSync` (mirrors `token`+`requestId` to SQLite), `TokenRotationProvider`, `useMXDBInvite` (temporary direct socket.io connection to `/{name}/register`), `deriveEncryptionKey` (WebAuthn PRF). IDB store `mxdb_authentication` holds `{ id, credentialId, dbName, token, requestId, isDefault }`. SQLite `mxdb_authentication` singleton row holds `{ token, requestId }`. |
| §4.5 `syncMode` field (`'Synchronised' | 'ServerOnly' | 'ClientOnly'`)                 | ✅      | Added to `MXDBCollectionConfig`, replaces `disableSync`                                                                                       |
| §4.5 `disableAudit` flag and `_sync` table for audit-free collections                  | ✅      | `_dirty` IDB store for dirty tracking; `mxdbSyncAuditFreeCollectionsAction`; LWW client-wins protocol; `mxdbServerPushAuditFree` event        |
| §4.5 Wrong-side collection guard (`useCollection` throws if `syncMode` doesn't apply)  | ✅      | `useCollection` throws on `syncMode === 'ServerOnly'`                                                                                         |
| §4.5 `NestedKeyOf<T>` for index field paths                                            | ✅      | `src/common/models.ts`                                                                                                                        |
| §4.6 Server-side data encryption                                                       | 🚧     | App responsibility; no library code needed                                                                                                    |
| §4.7 Transport security (WSS enforcement)                                              | ✅      | `MXDBSync` validates `host` prop; throws if protocol is not `wss://`                                                                          |
| §4.8 Sign-out flow (close DB, clear state, broadcast to tabs)                          | 🔄     | `useMXDBSignOut` hook calls `AuthTokenContext.clearToken` → nulls `connectionToken` in `IndexedDbBridge` → removes `auth` from `SocketAPI` → socket disconnects + `DbsProvider` unmounts (closes SQLite DB). **Gap:** SharedWorker does not yet broadcast a `"signed-out"` event to other tabs — sign-out only affects the calling tab. |
| §4.9 Multi-tab coordination (SharedWorker / Web Locks + BroadcastChannel fallback)     | 🔄     | `sqlite-shared-worker.ts` owns one SQLite instance; assigns portIds on connect; broadcasts `change-notification` after writes; `SqliteWorkerClient` auto-selects shared/dedicated/inline mode; `DbCollection.reloadFromWorker()` refreshes cache and emits `'reload'` event. **Gap:** Web Locks + BroadcastChannel fallback for Safari/Cordova not implemented — Safari falls back to a dedicated Worker per tab with no cross-tab coordination or leader election. |


---

## §5 – The Sync Lifecycle


| Item                                                                              | Status | Notes                                                                                                                           |
| --------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| §5.1 Client authentication via opaque token (Bearer header on WebSocket upgrade)  | ✅      | Token + requestId passed via `socket.io` `auth` option. Server validates on `onClientConnected`: finds record by `pendingToken` or `currentToken`; if not found, uses `requestId` to disable the device (replay attack guard). Per-client `DeferredPromise` gate created in `onClientConnecting` (before handlers registered); all action handlers await it via `onBeforeHandle`; gate resolved after `emitWithAck` ack received from client. |
| §5.2 Clock drift from ULID token timestamp                                        | ✅      | `auditor.setClockDrift()` + `generateUlid()` adjusted; caller must invoke on token receipt                                      |
| §5.3 Server-side merge & materialisation (interleaving, replay rules)             | ✅      | `serverSyncAction.ts` — `auditor.merge`, `auditor.createRecordFrom`                                                             |
| §5.4 Sync request — `{ collectionName, updates: AuditOf[] }` (no separate ids)    | ✅      | `src/common/internalModels.ts`, `synchronise-collections.ts`                                                                    |
| §5.5 Sync response — per-id `{ id, auditEntryId?, record? }` when replay differs from server materialisation | ✅      | `serverSyncAction.ts` + client `synchronise-collections.ts`; rule 3 (new records from server) fixed to pass `auditEntryId`      |
| §5.6 Server push with `auditEntryId`, per-client record id set                    | ✅      | `useClient.ts`, `ServerToClientProvider.tsx`                                                                                    |
| §5.6 Audit-free push payload (`record` only, no `auditEntryId`)                   | ✅      | `mxdbServerPushAuditFree` event in `ServerToClientProvider`                                                                     |
| §5.7 Per-collection sync isolation and retries                                    | ✅      | Each collection syncs independently via `Promise.all`; up to 3 retries with exponential backoff; failures surface via `onError` |
| §5.8 CRUD blocking during sync (`finishSyncing`)                                  | ✅      | `SyncProvider` + `useSync` hook already gate all CRUD                                                                           |
| §5.9 Collection bootstrap — empty on first load, populated on demand              | ✅      | Existing subscription pattern unchanged                                                                                         |
| §5.10 Sync trigger — on connect and after local changes                           | ✅      | `SyncProvider` triggers on `onConnected`, polls every 2s while connected                                                        |
| §5.11 Sync idempotency — duplicate ULID entries deduplicated                      | ✅      | `auditor.merge` skips duplicate entry ids (§6.9#8)                                                                              |


---

## §6 – Conflict Resolution & Client State Management


| Item                                                               | Status | Notes                                                                                                 |
| ------------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------- |
| §6.1 Last-write-wins via ULID ordering                             | ✅      | `auditor.merge` sorts by ULID                                                                         |
| §6.2 Orphaned ops (nested deletion discards child updates)         | ✅      | `applyOp` silently drops ops whose parent is missing                                                  |
| §6.3 `useRecord` — field-level rebase on server push               | ✅      | `useRecord` tracks last DB state; on server push, rebases via `auditor.rebaseRecord(old, user, new)` |
| §6.4 Root record deletion conflict + `onConflictResolution`        | ✅      | `useRecord` detects server deletion while editing; calls `onConflictResolution`; upserts record if user chooses to restore |
| §6.5 `onError` callback on `MXDBSync`                              | ✅      | Prop added to `MXDBSync.tsx`                                                                          |
| §6.5 `error?: MXDBError` on `useGet`, `useQuery`, `useDistinct`    | ✅      | All three hooks updated                                                                               |
| §6.6 Audit pruning and deep drift                                  | 🚧     | Explicitly deferred in design doc                                                                     |
| §6.7 Local-first creation collision (first ULID to server wins)    | ✅      | Natural result of ULID merge ordering                                                                 |
| §6.8 / §6.9 Audit replay / merge failure policy (all 18 scenarios) | ✅      | Scenarios 1–3, 5–9, 11–13, 16–18 covered; #4 ✅ corrupt entry validation; #10 ✅ null Created record; #14 ✅ per-record transient retry; #15 ✅ per-record permanent failure — `sync()` writes each record in its own transaction; returns `SyncWriteResult[]`; client receives `error` in `MXDBSyncIdResult` and fires `IO_PERMANENT` |


---

## §7 – Public API


| Item                                                                                                         | Status | Notes                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------- |
| §7.1 Conditional root export (`node` → server, `default` → client)                                           | ✅      | `package.json` exports + `typesVersions`                                                                                         |
| §7.2 `defineCollection`, `MXDBCollection`, `MXDBCollectionConfig`, `QueryProps` from common                  | ✅      | `src/common/`                                                                                                                    |
| §7.3 Unified `MXDBCollectionOperations<T>` interface (shared signatures)                                     | ✅      | Added to `src/common/models.ts`; covers `get`, `getAll`, `upsert`, `remove`, `query`, `find`, `distinct`, `onChange`            |
| §7.3 `remove` → `Promise<void>` (idempotent, not `Promise<boolean>`)                                         | ✅      | `createRemove` overloads changed to `Promise<void>`                                                                              |
| §7.3 `MXDBCollectionChangeEvent` — public shape `{ type: 'upsert' | 'remove' | 'clear', ... }`               | ✅      | `useCollection.onChange` wraps internal event, maps `ids` → `recordIds`, drops `auditAction`; `clear` events emitted as `remove` |
| §7.4 Server `useCollection` (Node.js async context, same imperative API)                                     | ✅      | `ServerDbCollection` + `useDb`                                                                                                   |
| §7.4 `createInviteLink`, `getDevices`, `enableDevice`, `disableDevice`                                       | ✅      | Plain async functions returned from `startServer()`; bound to MongoDB connection                                                  |
| §7.4 `extendCollection` lifecycle hooks (`onBefore/AfterUpsert/Delete/Clear`)                                | ✅      | Already implemented                                                                                                              |
| §7.5 `MXDBSync` provider — `onError`, `onConflictResolution`, `onSaveUserDetails`, `onRegisterInvitePattern` | ✅      | `onError` and `onConflictResolution` wired; `onSaveUserDetails` / `onRegisterInvitePattern` handled via `useMXDBInvite` callback pattern instead of props |
| §7.5 `useMXDBSync` hook — `isSynchronising`, `isConnected`, `onConnectionStateChanged`, `onSyncChanged`      | ✅      | All four fields present; `clientId`, `testDisconnect`, `testReconnect` are extras                                                |
| §7.5 `useRecord` hook — `{ record, isLoading, error, upsert, remove }`                                       | ✅      | Returns `{ record, isLoading, error: MXDBError | undefined, upsert, remove }` via `useGet`                                       |
| §7.5 `useMXDBInvite` hook                                                                                    | ✅      | `{ isProcessing, error, handleInviteUrl }` — extracts `requestId`, runs WebAuthn credential create (falls back to random id), calls `mxdbRegisterDeviceAction`, stores token, triggers reconnect |
| §7.5 `useGet`, `useQuery`, `useDistinct` — `{ ..., error: MXDBError | undefined }`                           | ✅      | All three updated                                                                                                                |
| §7.6 `MXDBError`, `MXDBErrorCode` (16 codes), `MXDBErrorSeverity`                                            | ✅      | `src/common/models.ts`                                                                                                           |
| §7.7 `remove` → `Promise<void>` alignment (server already void, client needs fixing)                         | ✅      | Client `createRemove` now returns `Promise<void>`                                                                                |


---

## §8 – Implementation Follow-ups

### §8.1 Server


| Item                                                                   | Status | Notes                                                                            |
| ---------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------- |
| §8.1.1 Write atomicity (transactions)                                  | ✅      |                                                                                  |
| §8.1.2 Sync response with records + hash comparison                    | ✅      |                                                                                  |
| §8.1.3 Server push with per-client record id tracking + `auditEntryId` | ✅      |                                                                                  |
| §8.1.4 Audit replay failure decisions (§6.9)                           | ✅      | #4 ✅ corrupt entry validation; #10 ✅ null Created; #14 ✅ per-record transient retry; #15 ✅ per-record permanent failure |
| §8.1.5 Token rotation on every connection                              | ✅      | `TokenRotation.rotateBeforeAck()` (Case A: currentToken match → new pendingToken; Case B: pendingToken match → promote + new pendingToken); emits `mxdbTokenRotated` via `useEvent` (`emitWithAck` under the hood); awaits client ack; then `completeRotation()` sets `currentToken=newToken, pendingToken=null`; gate resolved after ack |
| §8.1.6 Invite link security (single-use, TTL, rate limiting)           | ✅      | `InviteNamespace` (`/{name}/register`): mark disabled before checks (single-use); ULID TTL decode; `inviteRateLimiter` (5/15m per IP); stores initial token as `pendingToken` |
| §8.1.7 API alignment — `remove` void, `find` uses `DataFilters`        | ✅      | Both already in place                                                            |
| §8.1.8 `createInviteLink` API                                          | ✅      | `createInviteLink(db, userId, domain)` in `deviceManagement.ts`; returned from `startServer()` |
| §8.1.9 `getDevices`, `enableDevice`, `disableDevice` APIs              | ✅      | All three in `deviceManagement.ts`; returned from `startServer()`                |


### §8.2 Client


| Item                                                                        | Status | Notes                                                               |
| --------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------- |
| §8.2.1 Post-sync anchor reset (collapse audit to branch) + hash send        | ✅      | `synchronise-collections.ts`                                        |
| §8.2.2 Sync failure / timeout handling                                      | ✅      | `SyncProvider` catches and releases sync promise                    |
| §8.2.3 Disconnect during sync                                               | ✅      | `SyncProvider` socket disconnect handler                            |
| §8.2.4 Collection bootstrap (empty on first load)                           | ✅      | Existing behaviour                                                  |
| §8.2.5 `useRecord` rebase + conflict resurrection (§6.3–6.4)                | ✅      | Rebase and conflict resurrection fully wired; `onConflictResolution` called on server deletion while editing |
| §8.2.6 Client-side record deletion audit lifecycle                          | ✅      | `DbCollection.delete` adds `Deleted` audit entry                    |
| §8.2.7 Per-collection sync isolation and retries (§5.7)                     | ✅      | `synchronise-collections.ts` — per-collection `Promise.all` + 3-attempt retry                                                   |
| §8.2.8 SQLite + OPFS migration                                            | ✅      | `Db.ts` + `DbCollection.ts` migrated; `SqliteWorkerClient` + `sqlite-worker.ts`; `fake-indexeddb` no longer needed |
| §8.2.9 `DataFilters → SQL` transformer                                      | ✅      | `filtersToSql.ts` — all operators; `sortsToSql.ts`; expression indexes via `buildTableDDL.ts` |
| §8.2.10 CRUD blocking during sync                                           | ✅      |                                                                     |
| §8.2.11 Token rotation on connect (store new token in encrypted DB)         | ✅      | `TokenRotationProvider` listens for `mxdbTokenRotated`, calls `setToken` (updates IDB + triggers `SqliteTokenSync` to call `db.writeAuth(token, requestId)`); socket.io native ack returns to server automatically via `emitWithAck` |
| §8.2.12 Multi-tab coordination (SharedWorker / Web Locks)                   | ✅      | `sqlite-shared-worker.ts` + `SqliteWorkerClient` shared mode + `DbCollection.reloadFromWorker()` |
| §8.2.13 Sign-out flow                                                       | 🚧     | Requires §4.3 SQLite DB                                             |
| §8.2.14 Unknown collection handling (delete local collection on server 404) | ✅      | Server returns `notFound: true` in sync response; client calls `collection.clear('all')` |
| §8.2.15 `useGet`/`useQuery`/`useDistinct` `error` field                     | ✅      |                                                                     |
| §8.2.16 `onError` on `MXDBSync`                                             | ✅      |                                                                     |
| §8.2.17 Invite link handling + `useMXDBInvite`                              | ✅      | `useMXDBInvite` hook: opens temporary socket.io connection to `/{name}/register`, exchanges invite token, stores `{ credentialId, dbName, token, requestId }` in IDB via `saveEntry`. `IndexedDbBridge` replaces `AuthSocketBridge` — reads IDB on mount, provides stable `connectionToken`+`connectionRequestId` to SocketAPI, prevents reconnects on rotation |
| §8.2.18 Audit-free sync (`_sync` collection for `disableAudit: true`)       | ✅      | `_dirty` IDB store + `mxdbSyncAuditFreeCollectionsAction`; client-wins LWW                                                                  |


### §8.3 Cross-cutting


| Item                                                                 | Status | Notes                                          |
| -------------------------------------------------------------------- | ------ | ---------------------------------------------- |
| §8.3.1 Auth — no userId in audit entries, per-user encrypted DB      | ✅      | `userId` removed from all auditor calls        |
| §8.3.2 Hash-anchored op failure → silently dropped                   | ✅      | `applyOp` returns original on hash mismatch    |
| §8.3.3 `AuditOf` shape — no `version` / no client `hash` on audit; entry time from ULID | ✅      | `auditor-models` + `syncAction` deep-equal divergence |
| §8.3.4 WSS enforcement (reject plain WS)                             | ✅      | `MXDBSync` throws on non-`wss://` host         |
| §8.3.5 Package exports (conditional root)                            | ✅      |                                                |
| §8.3.6 `MXDBCollectionOperations<T>` as shared interface in common   | ✅      | Added to `src/common/models.ts`                |
| §8.3.7 Error types exported from common                              | ✅      |                                                |
| §8.3.8 Wrong-side collection guard                                   | ✅      | `useCollection` throws for `syncMode === 'ServerOnly'` |


---

## Next Up (Actionable Without Major Infrastructure)

In priority order:

All actionable items are now complete. Remaining work is deferred (see below).

## Next Up (Actionable Without Major Infrastructure)

- **§4.8 Sign-out broadcast** — Add `"signed-out"` message type to the SharedWorker that broadcasts to all connected ports; `SqliteWorkerClient` notifies listeners; `IndexedDbBridge` responds by clearing state. Medium complexity.
- **§4.9 Web Locks + BroadcastChannel fallback** — Leader election for Safari (no SharedWorker). Significant complexity — likely a separate workstream.

## Deferred (Requires Major New Infrastructure)

- **§6.6** Audit pruning and deep drift recovery

