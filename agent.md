# MXDB-Sync Library Overview

## Before making changes

- **Read**: `c:/code/personal/agents/global-agent.md`
- **Search `@anupheaus/common` before writing utility functions**: The common library (`c:/code/personal/common/src/`) provides many utilities — serialisation (`to.serialise`, `to.deserialise`), deep equality (`is.deepEqual`, handles Luxon DateTime, Date, functions), object cloning (`Object.clone`), type guards, and more. Before implementing anything locally, search the common library first. Using existing common utilities avoids duplicated logic and benefits from already-correct edge-case handling (e.g. `is.deepEqual` uses `DateTime.equals()` for Luxon, not naive JSON comparison).

## Documentation

All of this ships in the published package under **`docs/`** (see **`package.json` → `files`**). Start from the index, then drill into guides vs reference vs plans.

- **Index (table of contents):** [docs/README.md](docs/README.md)
- **Guides**
  - [docs/guides/client-guide.md](docs/guides/client-guide.md) — React app: `MXDBSync`, `useCollection`, auth, sync UX
  - [docs/guides/server-guide.md](docs/guides/server-guide.md) — `startServer`, MongoDB, extensions, auth
- **Reference**
  - [docs/reference/tech-overview.md](docs/reference/tech-overview.md) — architecture and sync flows (Mermaid)
  - [docs/reference/features.md](docs/reference/features.md) — exports, socket actions / events / subscriptions
- **Plans / target specs:** [docs/plans/](docs/plans/) — C2S/S2C specs, client record creation, [docs/plans/design.md](docs/plans/design.md) (master design)
- **Archive:** [docs/archive/](docs/archive/) — older trackers (see [docs/archive/README.md](docs/archive/README.md))

**Root [README.md](README.md)** — quick start, exports, and links back to **`docs/README.md`**.

## Architecture Summary

MXDB-Sync is a real-time synchronization library for MongoDB-backed collections between clients and servers. It provides a three-layer architecture:

### Core Components

**Common Layer** (`src/common/`)
- Collection definitions via `defineCollection()`
- Shared types and models
- Internal actions, events, and subscriptions
- Seeding utilities

**Server Layer** (`src/server/`)
- `startServer()` - Main server initialization
- Collection API and extension hooks
- MongoDB change stream integration
- Real-time notifications via Socket.IO

**Client Layer** (`src/client/`)
- React provider (`MXDBSync`) 
- Hooks (`useCollection`, `useMXDBSync`, `useRecord`)
- Local IndexedDB storage with sync capabilities
- Real-time updates and offline support

## Key Features

1. **Real-time Sync**: Uses MongoDB change streams to notify clients of changes
2. **Offline Support**: Clients store data locally in IndexedDB and sync when reconnected
3. **Audit Trail**: Maintains change history for conflict resolution
4. **React Integration**: Native React hooks and components
5. **Extensible**: Server-side hooks for validation and cascading updates

## Data Flow

### Server Operations
1. Client actions (upsert/remove) received via Socket.IO
2. Server validates and writes to MongoDB
3. MongoDB change stream detects changes
4. Server runs `onAfter` hooks then notifies clients
5. Clients receive updates and apply to local IndexedDB

### Client Operations
1. Local changes stored immediately in IndexedDB
2. If connected, changes sent to server
3. If disconnected, changes queued for sync
4. On reconnect, synchronization process runs
5. Conflict resolution using ULID-based last-write-wins (audit entry ULID, NOT any record field)

## Conflict Resolution: ULID-Based Last-Write-Wins

**The ONLY mechanism for conflict resolution is the ULID of the audit entry.** The entry with the highest ULID (latest real-world write time) wins when two writes conflict.

- `replayHistoryEndState` in `src/common/auditor/replay.ts` sorts all audit entries by ULID and applies them in order. The last applied state is the record's final value.
- `audit.merge` in `src/common/auditor/api.ts` merges server + client audits by deduplicating and sorting all entries by ULID.
- **Record fields like `testDate` (or any other application-level field) have NO effect on conflict resolution.** They are arbitrary data stored on the record. Only the ULID of the audit entry matters.
- `testDate` on `E2eTestRecord` is an optional test-only field — it is explicitly NOT used by the sync system for ordering or conflict resolution.

## Deletion and Restoration Behaviour

**Updates after a deletion do NOT restore a record.** When an `Updated` entry has a higher ULID than a `Deleted` entry, the record remains deleted. The `Updated` entry is still applied to the `shadow` state (preserving the changes), but `live` stays `undefined` until an explicit `Restored(3)` entry is present.

**Restoration is a separate, manual process that has not been implemented yet.** A user who wants to un-delete a record must explicitly apply a `Restored` audit entry. There is currently no automatic restoration pathway — not from concurrent updates, not from conflict resolution. Only `AuditEntryType.Restored` (3) can bring a record back from `live=undefined` to a live state.

**Clients may still send C2S updates for a record after receiving it in `removedIds`.** If the local audit has pending changes (entries after the last Branched anchor) at the time the S2C deletion arrives, the S2C handler skips the deletion and keeps the local record. This is expected and intentional — the pending changes cannot be discarded until they have been pushed to the server and acknowledged. The flow is:
1. S2C deletion arrives → client has `hasPendingChanges=true` → deletion skipped, record retained locally
2. Client sends pending changes via C2S sync
3. Server ACKs the update (the record appears in `successfulRecordIds` even though the server sees it as deleted — no error is set for a deleted record result)
4. Client collapses audit to a `Branched(4)` anchor → `hasPendingChanges=false`
5. Server fires a follow-up S2C deletion (fire-and-forget from the C2S handler) to this specific client
6. S2C deletion re-arrives after the C2S gate opens → `hasPendingChanges=false` → deletion proceeds

## Sync Test Infrastructure

Located in `tests/sync-test/`, this is a comprehensive data integrity test suite:

### Test Components
- **50 simulated clients** using real React components and fake-indexeddb
- **MongoDB Memory Server** for isolated testing
- **Records of Truth** tracking expected final state
- **Integrity assertions** comparing server vs expected state

### Test Scenarios
- Random client updates while connected/disconnected
- Network delays and disconnections
- Server restart mid-session
- Concurrent operations from multiple clients

## Current Issue

The sync test is failing due to **extra records on the server** that don't match the expected state from the records of truth. This suggests either:
- Duplicate record creation during sync
- Improper conflict resolution
- Race conditions in the sync process
- Issues with audit trail merging

## Key Files to Investigate

### Sync Process
- `src/client/providers/sync/synchronise-collections.ts` - Main sync logic
- `src/server/collections.ts` - Server-side collection operations
- `src/common/models.ts` - Data models and audit structures

### Test Infrastructure
- `tests/sync-test/clientSync.integration.test.ts` - Main test runner
- `tests/sync-test/integrityAssertions.ts` - Validation logic
- `tests/sync-test/recordsOfTruth.ts` - Expected state tracking

### Server Extensions
- Look for `extendCollection()` calls with `onAfter` hooks
- Check for cascading updates that might create extra records

## Debugging Approach

1. **Run the sync test** to reproduce the issue
2. **Examine logs** in `tests/sync-test/logs/` for timing and operation details
3. **Check integrity report** for specific extra record IDs
4. **Trace record lifecycle** from creation through sync to final state
5. **Verify audit trail merging** logic for proper conflict resolution

## Critical Design Principles

**Data Integrity is Paramount**: This library's primary purpose is maintaining data consistency across distributed clients. Any changes must prioritize:
- **Preserving audit records** - Never truncate or lose audit trail data
- **Maintaining referential integrity** - Ensure cascading updates don't orphan data
- **Atomic operations** - Changes should be all-or-nothing to prevent partial states
- **Conflict resolution** - ULID-based last-write-wins: the audit entry with the highest ULID wins; record fields like `testDate` have no effect on conflict resolution

**Audit Record Preservation**: When making any changes to this library:
- Never remove or modify existing audit trail entries
- Ensure all write operations append to audit trails rather than replacing them
- Test thoroughly with the sync test suite to verify audit integrity
- Consider backward compatibility for existing audit data

## Next Steps

The sync test provides a controlled environment to identify and fix data integrity issues. The comprehensive logging and records of truth make it possible to trace exactly where extra records are being created and why they don't match the expected final state.

## Running "All" Tests

When the user asks to run "all" tests, run the following four suites **sequentially** (each as a separate Bash call), recording the wall-clock duration and exit status of each:

| Suite       | Command                  |
|-------------|--------------------------|
| Unit        | `pnpm test`              |
| CRUD        | `pnpm test:crud`         |
| Performance | `pnpm test:performance`  |
| Stress      | `pnpm test:stress`       |

After all four have finished, output a **summary table** in this format:

| Suite       | Status | Duration |
|-------------|--------|----------|
| Unit        | ✅ Pass / ❌ Fail | Xs |
| CRUD        | ✅ Pass / ❌ Fail | Xs |
| Performance | ✅ Pass / ❌ Fail | Xs |
| Stress      | ✅ Pass / ❌ Fail | Xs |

- **Status**: ✅ Pass if the command exited 0, ❌ Fail otherwise.
- **Duration**: wall-clock time for that suite (e.g. `42s`, `2m 3s`).
- Always run all four suites even if an earlier one fails, so the full picture is visible.
