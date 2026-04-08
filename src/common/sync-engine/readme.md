# Sync Engine (`src/common/sync-engine/`)

This is the **living reference** for the sync engine. It describes how the current implementation actually works — keep it up to date alongside code changes. If you are an agent picking this area up for the first time, read this document before editing anything in this folder.

---

## 1. What it is

A framework-agnostic module that implements the sync protocol between clients and the server. It owns **state** and **transitions**; the layers above it (React providers, sockets, IndexedDB, MongoDB) own **transport**.

It is made of four components — a dispatcher/receiver pair for each direction of data flow:

| Name | Direction | Lives on | Responsibility |
|------|-----------|----------|----------------|
| [`ClientDispatcher`](ClientDispatcher.ts) (CD) | Client → Server | Client | Builds and dispatches C2S sync batches to the server |
| [`ServerReceiver`](ServerReceiver.ts) (SR) | Client → Server | Server | Receives C2S batches, merges audits, replays, persists |
| [`ServerDispatcher`](ServerDispatcher.ts) (SD) | Server → Client | Server | Filters and dispatches S2C push payloads to one client |
| [`ClientReceiver`](ClientReceiver.ts) (CR) | Server → Client | Client | Applies S2C pushes to the local store |

One **SR + SD pair is created per connected client** on the server. One **CD + CR pair exists per client**.

---

## 2. Design rules

Hard constraints. Every component, flow, and model must respect them.

1. **Server-only audit merging.** Audit entries are only ever merged on the server (`ServerReceiver`). The client never merges audit trails — it only collapses its own local audit to a `Branched` anchor after the server acknowledges a successful sync, or replaces its anchor id when the `ClientReceiver` applies a server push.
2. **Audit entries must never be lost.** No operation — sync, collapse, push, apply — may discard or overwrite audit entries. Collapsing to a `Branched` anchor is the only permitted form of compaction and must only happen after the server has confirmed receipt. Any failure path must leave the full audit trail intact.
3. **Failure-safe and self-healing.** A failure at any point — mid-dispatch, mid-merge, mid-apply, on either side of the transport — must leave the system recoverable. On restart or reconnect, components must re-derive correct state from what is persisted and converge without manual intervention.
4. **In-memory read layer.** Collections are persisted to SQLite, but an in-memory layer maintains an always-current copy that can be read synchronously. Callbacks such as `onPayloadRequest`, `onStart` (CD), `onRetrieve` / `onUpdate` (CR) are synchronous because they hit this in-memory layer. Only initial load and background persistence touch SQLite directly.
5. **Delete is final.** Once a record is deleted — on either side — it must never be resurrected. This is enforced at **every** boundary:
    - **CR**: refuses active cursors whose local state is a tombstone (see §6.2).
    - **SD**: tracks `#deletedRecordIds` per collection and unconditionally adds every successfully-deleted id to it, regardless of whether the record was previously in the filter (see §5.3).
    - **SR**: the source of truth — once a record materialises as deleted, the server emits deletion cursors to all connected SDs.
    - **Client store**: retains tombstones (audit trail with a trailing `Deleted` entry, no live record) so subsequent stale actives can be recognised and rejected.

---

## 3. Shared models

Defined in [models.ts](models.ts). The important ones:

### `MXDBRecordStatesRequest`
```typescript
interface MXDBRecordStatesByCollectionRequest { collectionName: string; recordIds: string[]; }
type MXDBRecordStatesRequest = MXDBRecordStatesByCollectionRequest[];
```

### `MXDBRecordStates`
Current state of records — active or deleted (tombstone):
```typescript
interface MXDBActiveRecordState<T extends Record = Record> { record: T; audit: AuditEntry[]; }
interface MXDBDeletedRecordState { recordId: string; audit: AuditEntry[]; }
type MXDBRecordStates<T extends Record = Record> = {
  collectionName: string;
  records: (MXDBActiveRecordState<T> | MXDBDeletedRecordState)[];
}[];
```

### `MXDBRecordCursors`
Lightweight cursors used by SD → CR dispatches. Carries only `lastAuditEntryId`, not the full audit:
```typescript
interface MXDBActiveRecordCursor<T extends Record = Record> { record: T; lastAuditEntryId: string; hash?: string; }
interface MXDBDeletedRecordCursor { recordId: string; lastAuditEntryId: string; }
type MXDBRecordCursors<T extends Record = Record> = {
  collectionName: string;
  records: (MXDBActiveRecordCursor<T> | MXDBDeletedRecordCursor)[];
}[];
```

> **Hash on active cursors**: the SR attaches `hash` (materialised record hash) when it builds cursors to push to SDs. The SD uses this to skip dispatches where the filter already shows the client has an identical hash + `lastAuditEntryId`.

### `MXDBSyncEngineResponse`
```typescript
type MXDBSyncEngineResponse = { collectionName: string; successfulRecordIds: string[]; }[];
```
Used everywhere a component needs to report which ids it accepted.

### `MXDBUpdateRequest`
Passed by CD and CR to their `onUpdate` callback — what the local store should commit:
```typescript
type MXDBUpdateRequest<T extends Record = Record> = {
  collectionName: string;
  records?: { record: T; lastAuditEntryId: string }[];
  deletedRecordIds?: string[];
}[];
```

### `ServerDispatcherFilter`
The SD's per-client view of what records the client holds:
```typescript
interface ServerDispatcherFilter {
  collectionName: string;
  records: {
    id: string;
    /** Absent when the record is a *pending deletion* — delete sent but not yet confirmed. */
    hash?: string;
    lastAuditEntryId: string;
  }[];
  /** Ids the client has confirmed deleted — registered into #deletedRecordIds by updateFilter. */
  deletedRecordIds?: string[];
}
```

### `SyncPausedError`
Thrown by `ClientReceiver.process` when the CR is paused. The SD catches this specific type to distinguish "CR is paused — schedule retry" from "unexpected failure — propagate".

---

## 4. ClientDispatcher

See [ClientDispatcher.ts](ClientDispatcher.ts). Tests in [ClientDispatcher.tests.ts](ClientDispatcher.tests.ts).

### 4.1 Purpose

Runs on the client. Maintains a queue of records with pending local changes and periodically dispatches them to the SR. On start, sends a full snapshot of every record the client holds so the SD can build its filter.

### 4.2 Lifecycle

- **`start()`** — idempotent. Calls `#doStart()` which loops: read snapshot via `onStart` → dispatch → on failure retry after `timerInterval`. Only once the initial dispatch succeeds does the regular timer loop take over.
- **`enqueue(item)`** — no-op if not started. If the `(collectionName, recordId)` pair is already queued **and** a dispatch is in-flight, the id is added to `#pendingReEnqueue` (see §4.4). Otherwise duplicates are silently discarded. If neither the timer nor an in-flight dispatch is running, starts the timer.
- **`stop()`** — increments `#epoch` (invalidating any in-flight response), clears the timer, empties the queue, clears `#pendingReEnqueue`, disables `enqueue`.

### 4.3 Timer tick flow (`#timerTick`)

1. Groups the queue by collection into a `MXDBRecordStatesRequest`.
2. Calls `onPayloadRequest` (synchronous) → `MXDBRecordStates`.
3. **Drop-filter**: filters `#queue` down to only entries whose state still exists in the returned `MXDBRecordStates`. Records that have disappeared locally (e.g. deleted by an incoming S2C push while sitting in the queue) are dropped — otherwise they would sit in the queue forever.
4. Captures `#epoch`, sets `#inFlight = true`.
5. Calls `#buildRequest(states)` which hashes each active record and wraps everything into a `ClientDispatcherRequest`. All audit entries including `Branched` are included; the SR strips `Branched` entries before merging.
6. Calls `onDispatching(true)`, `clientReceiver.pause()`, then `onDispatch(request)`.
7. On success with matching epoch, calls `#processSuccessResponse` which:
    - Builds a `MXDBUpdateRequest` from successful ids and calls `onUpdate`. Active records use the **insertion-order last** audit entry id as `lastAuditEntryId` — see §4.5 below — **not** the max ULID.
    - Removes successfully-dispatched items from `#queue`.
    - For each entry in `#pendingReEnqueue` whose id is in `successfulRecordIds`, re-queues that record (see §4.4).
8. `finally`: `#inFlight = false`, `onDispatching(false)`, `clientReceiver.resume()`.
9. On success with non-empty queue, restarts the timer. On failure, restarts the timer to retry.

### 4.4 `#pendingReEnqueue` — the in-flight race

**Scenario**: `enqueue(X)` is called while X is already being dispatched. A naive implementation would no-op (X is already in the queue), but `#processSuccessResponse` then removes X from the queue after success, **silently losing** the update that triggered the re-enqueue.

**Fix**: when `enqueue` sees a duplicate **and** `#inFlight` is true, the id goes into `#pendingReEnqueue`. After success, any id in this set is re-queued for the next dispatch.

Regression test: [ClientDispatcher.tests.ts](ClientDispatcher.tests.ts) — "re-enqueues a record whose enqueue arrived while it was in-flight".

### 4.5 `lastAuditEntryId` — insertion order, not max ULID

When `#processSuccessResponse` builds the `MXDBUpdateRequest` for successful records, it uses `state.audit[state.audit.length - 1].id` — **not** `getLastEntryId` (max ULID).

**Why**: after `collapseToAnchor`, the audit can look like:
```
[Branched(server-ulid-NEW), Updated(client-ulid-OLD)]
```
The Branched anchor's id (server-generated) can be lexicographically *greater* than the client-generated Updated entries that follow it. Picking the max-ULID entry would return the anchor, leaving the pending Updated entries stranded after the collapse point — the audit would never become branch-only again, and the record would sit in C2S purgatory forever.

Using insertion order is correct because `collapseToAnchor` always places the `Branched` anchor at the front.

Regression test: [ClientDispatcher.tests.ts](ClientDispatcher.tests.ts) — "uses the last audit entry (insertion order) for lastAuditEntryId, not the max ULID".

### 4.6 Props

```typescript
interface ClientDispatcherProps {
  clientReceiver: ClientReceiver;
  onPayloadRequest<T>(request: MXDBRecordStatesRequest): MXDBRecordStates<T>;
  onDispatching(isDispatching: boolean): void;
  onDispatch(payload: ClientDispatcherRequest): Promise<MXDBSyncEngineResponse>;
  onUpdate(updates: MXDBUpdateRequest): void;
  onStart(): MXDBRecordStates;
  timerInterval?: number; // default 250ms
}
```

---

## 5. ServerDispatcher

See [ServerDispatcher.ts](ServerDispatcher.ts). Tests in [ServerDispatcher.tests.ts](ServerDispatcher.tests.ts).

### 5.1 Purpose

Runs on the server, one instance per connected client. Owns a per-client filter (`#filter`) and a tombstone set (`#deletedRecordIds`). Given an incoming push from the SR, it compares against the filter, skips anything the client is already up to date on, and dispatches only the delta to the CR.

### 5.2 Core flow (`#dispatch`)

1. Record `queueLength`, squash the queue via [`squashCursors`](utils.ts) — **delete-wins**: if a delete exists for a record anywhere in the queue, it overrides all updates for that id.
2. For each cursor, compare against `#filter` and `#deletedRecordIds`:
    - **Delete cursor**:
        - If the collection is unknown to the filter **or** the record is not in the filter records: **send the delete anyway**. The CR gracefully handles "no local state" as already-consistent, and the delete may be needed by a client that acquired the record via another route (bootstrap, concurrent push). This is safe because redundant deletes are idempotent.
        - If the filter record is a **pending deletion** (hash absent): compare `lastAuditEntryId` with the filter entry, send the one with the later id.
        - Otherwise: send the delete.
    - **Active cursor**:
        - If the record is in `#deletedRecordIds` (for this collection): **skip** — delete is final.
        - If the record is in the filter and the filter entry is a **pending deletion** (hash absent): re-send the pending delete rather than the active cursor. _(Defensive — should not occur in practice.)_
        - If the filter entry's `hash` + `lastAuditEntryId` match the cursor: **skip** — client is already up to date.
        - Otherwise: send the active.
3. If the fresh request is empty, return without calling `onDispatch`.
4. Set `#inFlight = true`, call `onDispatch(freshRequest)`.
5. On success, update `#filter` and `#deletedRecordIds` using `successfulRecordIds`:
    - **Successful delete**: remove the record from `#filter.records` if present **and** add its id to `#deletedRecordIds[colName]` unconditionally (see §5.3). Also remove it from the queue.
    - **Unsuccessful delete** (sent but not in `successfulRecordIds`): mark the filter record as *pending deletion* — clear `hash`, keep the `lastAuditEntryId` of the sent delete. It is assumed the client has pending changes still in-flight via C2S; once those land, the SR will trigger another push which will re-send the delete.
    - **Successful active**: update or add the filter record with the cursor's `hash` and `lastAuditEntryId`.
6. Trim `#queue` by `queueLength` and push back any failed records for retry.
7. `finally`: `#inFlight = false`.
8. **On success**: if `#queue` is non-empty and not paused, call `#dispatch` again.
    **On `SyncPausedError`** (CR is paused): start `#retryTimer` with `retryInterval` (default 250ms).
    **On any other error**: rejection propagates.

### 5.3 `#deletedRecordIds` is populated unconditionally

**Regression**: there used to be a `wasInFilter` gate that only added an id to `#deletedRecordIds` if the record had previously been in the filter. This was removed.

**Why**: clients can acquire a record via routes the SD didn't see (bootstrap, initial seed, a concurrent S2C push that originated elsewhere). If the client then deletes the record and the delete succeeds, the SD *must* remember that — otherwise a subsequent stale active cursor arriving via squash or broadcast would slip through the filter and be dispatched to the CR, which would then have to refuse resurrection. Better to catch it at the SD.

Regression test: [ServerDispatcher.tests.ts](ServerDispatcher.tests.ts) — "successful delete for a record never seen in filter still populates deletedRecordIds".

### 5.4 Pause / resume

`pause()` sets `#isPaused = true`. `resume()` clears it and calls `#dispatch` if nothing is in-flight and no retry timer is running. `push()` always adds to the queue; it only calls `#dispatch` when not paused, not in-flight, and no retry timer.

### 5.5 Props

```typescript
interface ServerDispatcherProps {
  onDispatch<T>(payload: MXDBRecordCursors<T>): Promise<MXDBSyncEngineResponse>;
  retryInterval?: number; // default 250ms
}
```

---

## 6. ClientReceiver

See [ClientReceiver.ts](ClientReceiver.ts). Tests in [ClientReceiver.tests.ts](ClientReceiver.tests.ts).

### 6.1 Purpose

Runs on the client. Accepts `MXDBRecordCursors` pushes from the SD, filters them against the local store, and commits the accepted changes via `onUpdate`.

### 6.2 `process` flow

1. Throws `SyncPausedError` immediately if paused — the SD catches this and schedules a retry.
2. Build a `MXDBRecordStatesRequest` from the payload; call `onRetrieve` → current local states (active or tombstone).
3. For each cursor, look up its local state and decide:
    - **No local state + active cursor** → accept (new record).
    - **No local state + delete cursor** → no-op, but include the id in `successfulRecordIds` so the SD clears it from its queue. Logged at warn.
    - **Local state is a tombstone + active cursor** → **refuse**. This is the delete-is-final enforcement point on the CR. The client has just deleted this record locally; the active cursor was dispatched before the local delete was written (or while it was still in-flight through the network). The client's local tombstone wins. Logged at debug — this is an expected race, not a bug.
    - **Local state is a tombstone + delete cursor** → already consistent. Include the id in `successfulRecordIds`.
    - **Local state has pending local changes** (not branch-only) → skip. The CD will merge via C2S.
    - **Local state is branch-only + active cursor whose `lastAuditEntryId` is older than the local branch ULID** → skip (stale). Delete cursors bypass this check — delete-is-final overrides staleness.
    - **Local state is branch-only + cursor is newer** → accept.
4. Build an `MXDBUpdateRequest` from the accepted cursors and call `onUpdate`. Merge any "no local state delete" and "tombstone delete" ids into the returned `MXDBSyncEngineResponse`.

Regression tests for the delete-is-final cases: [ClientReceiver.tests.ts](ClientReceiver.tests.ts) — "refuses to resurrect a locally-tombstoned record" and "treats a delete cursor against a local tombstone as already-consistent".

### 6.3 Pause / resume

`pause()` is called by the CD before each `onDispatch` to prevent an S2C push from being processed while a C2S dispatch is in-flight (avoids cross-flow races). `resume()` is called after the dispatch completes.

### 6.4 Props

```typescript
interface ClientReceiverProps {
  onRetrieve<T>(request: MXDBRecordStatesRequest): MXDBRecordStates<T>;
  onUpdate(updates: MXDBUpdateRequest): MXDBSyncEngineResponse;
}
```

---

## 7. ServerReceiver

See [ServerReceiver.ts](ServerReceiver.ts). Tests in [ServerReceiver.tests.ts](ServerReceiver.tests.ts).

### 7.1 Purpose

Runs on the server, one instance per connected client. Given a `ClientDispatcherRequest`, it merges the incoming audits with the server's current audits, replays to materialise the new state, persists, updates the SD's filter, and broadcasts any resulting cursors to all connected SDs (including the originator).

### 7.2 `process` flow

1. `serverDispatcher.pause()` — holds S2C pushes while processing.
2. Build a `MXDBRecordStatesRequest` from the request and call `onRetrieve` for the current server states.
3. For each incoming record, strip `Branched` entries from the client audit:
    - **No entries remain** + has `hash` (branched-only active) → seed the SD filter directly from the client's anchor; no merge needed.
    - **No entries remain** + no `hash` → collect into `deletedRecordIds` for the filter. (Defensive — shouldn't happen in practice.)
    - **Entries remain** → merge with server audit, replay → materialised state (active or deleted). If merge/replay throws, log and skip that record.
4. Call `onUpdate(states)` with the materialised states. Returns a `MXDBSyncEngineResponse` of successfully-persisted ids. Failed saves must leave the audit trail intact for retry.
5. Collect `successfulRecordIds` = saved-in-step-4 ∪ branched-only-in-step-3.
6. Build `ServerDispatcherFilter[]` from the successful ids:
    - Active → `{ id, hash, lastAuditEntryId }`.
    - Deleted → no filter record; id goes into `deletedRecordIds`.
7. `serverDispatcher.updateFilter(filters)` — merges into the SD's `#filter` and registers deletions into `#deletedRecordIds`.
8. Build an S2C push payload by diffing server state vs. what the client sent, then **broadcast to every connected SD** (including the originator — the filter suppresses redundant dispatches, not the broadcast). For each record:
    - **Saved active**: if materialised hash differs from the client's hash → active cursor in the payload.
    - **Saved, materialised as deleted** but client sent active → delete cursor in the payload.
    - **Branched-only active, server is active with different hash** → active cursor in the payload.
    - **Branched-only active, server is deleted** → delete cursor in the payload (client missed an earlier deletion).
    - **Branched-only deleted** → no push needed.
9. `finally`: `serverDispatcher.resume()`.
10. Return the `MXDBSyncEngineResponse`.

### 7.3 Broadcast must include the originator

It is tempting to skip broadcasting to the SD that belongs to the client which just sent the C2S. **Don't.** The SD's filter already suppresses redundant dispatches (the hash + `lastAuditEntryId` will match), so there is nothing to suppress at the broadcast layer. Skipping the originator creates a subtle race where a concurrent update from another client can slip past without the originator's SD filter being updated.

---

## 8. Flow summary

```
                                          ┌──────────────┐
                                          │   Server     │
                                          │              │
   ┌──────────┐   C2S (ClientDispatch)    │  ┌─────────┐ │
   │  Client  │  ─────────────────────▶   │  │   SR    │ │
   │          │                           │  └────┬────┘ │
   │   ┌──┐   │                           │       │      │
   │   │CD│   │                           │   merge+     │
   │   └──┘   │                           │   replay+    │
   │          │                           │   persist    │
   │   ┌──┐   │                           │       │      │
   │   │CR│   │   S2C (ServerDispatch)    │       ▼      │
   │   └──┘   │  ◀─────────────────────   │  ┌─────────┐ │
   └──────────┘    broadcasts to all SDs  │  │   SD    │ │
                                          │  │ (per    │ │
                                          │  │ client) │ │
                                          │  └─────────┘ │
                                          └──────────────┘
```

- **CD → SR**: hashes records, builds `ClientDispatcherRequest` with full audit (including `Branched`), awaits `MXDBSyncEngineResponse`, commits `onUpdate` for successful ids.
- **SR → SD (own)**: updates filter with confirmed client state.
- **SR → all SDs**: broadcasts resulting cursors (filter dedupes redundant dispatches per-client).
- **SD → CR**: filters cursors against its per-client view, dispatches only the delta.
- **CR → store**: accepts via `onUpdate` after delete-is-final and staleness checks.

---

## 9. Testing

- **Unit tests** for each component in `*.tests.ts` siblings. Run with `npx vitest run src/common/sync-engine/`.
- **Stress test** in [syncEngine.stress.tests.ts](syncEngine.stress.tests.ts) — spins up 12 clients doing creates/updates/deletes for 30s with injected network failures, then asserts all clients converge to server state within the settle window. Covers the full four-component interaction that individual unit tests cannot.

When you touch any file in this folder:
1. Run the affected component's unit tests.
2. Run the stress test. A single pass is not enough — run it **multiple times** (5+) if you touched any race-sensitive code (CD reenqueue, SD filter, CR tombstone checks, SR broadcast).

### 9.1 Invariants covered by unit tests

If a regression causes a stress-test flake, check if one of these unit tests would have caught it:

| Invariant | Test file | Test name |
|---|---|---|
| Delete-is-final (CR refuses resurrection) | `ClientReceiver.tests.ts` | "refuses to resurrect a locally-tombstoned record" |
| Delete against tombstone is no-op success | `ClientReceiver.tests.ts` | "treats a delete cursor against a local tombstone as already-consistent" |
| `#deletedRecordIds` populated unconditionally | `ServerDispatcher.tests.ts` | "successful delete for a record never seen in filter still populates deletedRecordIds" |
| Unknown-record deletes are forwarded, not swallowed | `ServerDispatcher.tests.ts` | "sends delete cursors through even when record is unknown to filter" |
| `#deletedRecordIds` blocks active cursors (filterItem null branch) | `ServerDispatcher.tests.ts` | "blocks active cursors when id is in deletedRecordIds and filterItem is null" |
| `delete-wins` in `squashCursors` | `ServerDispatcher.tests.ts` | "delete wins over update in squash" |
| CD `#pendingReEnqueue` in-flight race | `ClientDispatcher.tests.ts` | "re-enqueues a record whose enqueue arrived while it was in-flight" |
| CD drops queue entries whose state disappeared | `ClientDispatcher.tests.ts` | "drops queue entries whose state has disappeared before dispatch" |
| CD uses insertion-order `lastAuditEntryId`, not max ULID | `ClientDispatcher.tests.ts` | "uses the last audit entry (insertion order) for lastAuditEntryId, not the max ULID" |

---

## 10. Side notes

### 10.1 MongoDB change stream — deleted record propagation

The MongoDB change stream handler filters change events before passing them to `onChange`: once a record is deleted, only the original `Deleted` transition is propagated; subsequent mutations to a tombstoned record's audit are silently absorbed. This prevents "resurrection pushes" from ever reaching the SD layer.
