# Auditor (`src/common/auditor/`)

The library's conflict-resolution engine. Every write creates an audit entry; the auditor merges, replays, and diffs entries to materialise record state.

## Overview

The auditor implements ULID-ordered last-write-wins conflict resolution. It does not store records directly — it stores an ordered sequence of operations and derives record state by replaying them. The entry with the highest ULID wins when two writes conflict.

This module is the most critical in the library. Changes here affect data integrity across all clients and the server. Read [sync-engine/AGENTS.md](../sync-engine/AGENTS.md) before touching anything that consumes the auditor.

## Contents

### Entry point (`index.ts`)
Re-exports `auditor` (the public facade object), `hashRecord`, `setClockDrift`, `AuditEntryType`, and all type exports.

### Facade (`auditor.ts`)
Pre-binds a ULID generator so callers don't pass it. Everything should `import { auditor } from '../common'` and use this object, not the raw `api.ts` functions.

Key members on `auditor`:
- `auditor.createAuditFrom(record)` — new audit for a new record
- `auditor.updateAuditWith(currentRecord, audit, baseRecord?, logger?)` — append an `Updated` entry for a field change
- `auditor.merge(serverAudit, clientAudit)` — deduplicate + ULID-sort entries; **server-only**, never call on client
- `auditor.collapseToAnchor(audit, anchorUlid)` — replace entries up to `anchorUlid` with a `Branched` anchor; entries after the anchor are preserved as pending
- `auditor.rebaseRecord(localRecord, serverRecord, audit)` — apply server changes over local pending edits
- `auditor.delete(audit)` — append a `Deleted` entry (soft delete)
- `auditor.restoreTo(audit, record, ...)` — append `Restored` + optional `Updated` entries
- `auditor.createRecordFrom(audit)` — materialise the current live state of a record from its audit

### Core API (`api.ts`)
Raw functions pre-bound by the facade. Also exports:
- `entriesOf(audit)` — safe accessor; returns `[]` for malformed input
- `filterValidEntries(entries)` — strips structurally invalid entries
- `hasPendingChanges(audit)` — `true` if there are entries after the last `Branched` anchor
- `isBranchOnly(audit)` — `true` if audit contains only a single `Branched` entry
- `isDeleted(audit)` — `true` if the last meaningful entry is `Deleted`
- `getLastEntryId(audit)` — max-ULID entry id (used for SD filter cursors)
- `getBranchUlid(audit)` — ULID of the current `Branched` anchor

### Replay (`replay.ts`)
- `replayHistoryEndState(entries, baseRecord?)` — folds all entries into `{ live, shadow }`. `live` is `undefined` for tombstoned records; `shadow` preserves the last non-deleted state.
- `applyOp(record, op)` — applies a single `AuditOperation` to a record

### Diff (`diff.ts`)
- `recordDiff(before, after)` — produces `AuditOperation[]` describing the minimal change set. Uses boxed-id path anchoring for arrays with `id`/`_id` elements; hash-anchored numeric indexing for anonymous arrays.

### Models (`auditor-models.ts`)
- `AuditEntryType` enum: `Created(0)`, `Updated(1)`, `Deleted(2)`, `Restored(3)`, `Branched(4)`
- `AuditOperation` — single field change (dot-notation path + optional hash for array moves)
- Type hierarchy: `AuditCreatedEntry`, `AuditUpdateEntry`, `AuditDeletedEntry`, `AuditRestoredEntry`, `AuditBranchedEntry`
- Server-side variants: `ServerAuditOf`, `ServerAuditEntry`, etc. — add `socketId`, `timestamp`

### Utilities
- `hash.ts` — `hashRecord(record)` short hash; used by the sync engine to skip no-op S2C dispatches
- `time.ts` — `generateUlid()` and `setClockDrift(ms)` (test-only time shift)

## Architecture

### Entry types and semantics

| Type | Payload | Semantics |
|------|---------|-----------|
| `Created(0)` | full record snapshot | First entry in every audit; sets initial live state |
| `Updated(1)` | `ops: AuditOperation[]` | Patch-set applied during replay |
| `Deleted(2)` | — | Tombstone; replay sets `live = undefined`, preserves `shadow` |
| `Restored(3)` | optional record | Resurrects a tombstoned record. Not yet used in production flows — no automatic restoration pathway exists |
| `Branched(4)` | — | Sync anchor; entries after it are pending client mutations the server hasn't seen yet |

### Replay invariant
`replayHistoryEndState` folds entries in insertion order. After `merge`, insertion order matches ULID order. Result is `{ live, shadow }`.

### `merge` semantics
Deduplicates by `entry.id`, then sorts by ULID ascending. Called **only on the server** in `ServerReceiver`. After merge, replay produces the new authoritative state; both the merged audit and materialised record are written.

### Array path encoding
`AuditOperation.path` uses two strategies:
- **Boxed-id**: `items.[id:abc].name` — stable even if the element moves
- **Hash-anchored numeric**: `items.2` with `hash` = truncated SHA-256 of the element before change — used when elements lack `id`/`_id`

## Ambiguities and gotchas

- **`Updated` after `Deleted` does not restore the record.** Replay preserves the update in `shadow` but `live` stays `undefined`. Only `Restored(3)` can bring a record back.
- **`Branched` anchor ULID can be lexicographically greater than the client entries that follow it.** Server-generated ULIDs are fresh; client-generated ones may be older. `collapseToAnchor` uses insertion-order last entry id, not max-ULID, to avoid stranding pending entries.
- **`filterValidEntries` silently drops malformed entries.** If audits unexpectedly become empty after a round-trip, check whether entries are being classified as invalid.
- **`setClockDrift`** is test-only. Never call in production.

## Related

- [../sync-engine/AGENTS.md](../sync-engine/AGENTS.md) — consumes auditor for merge and replay
- [../../server/providers/db/AGENTS.md](../../server/providers/db/AGENTS.md) — server persistence stores and retrieves audits
- [../../client/providers/dbs/AGENTS.md](../../client/providers/dbs/AGENTS.md) — client SQLite layer stores and retrieves audits
