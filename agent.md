# MXDB-Sync Library Overview

## Before making changes

- **Read**: `c:/code/personal/agents/global-agent.md`

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
5. Conflict resolution using audit trails and timestamps

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
- **Conflict resolution** - Audit trails enable proper last-write-wins resolution

**Audit Record Preservation**: When making any changes to this library:
- Never remove or modify existing audit trail entries
- Ensure all write operations append to audit trails rather than replacing them
- Test thoroughly with the sync test suite to verify audit integrity
- Consider backward compatibility for existing audit data

## Next Steps

The sync test provides a controlled environment to identify and fix data integrity issues. The comprehensive logging and records of truth make it possible to trace exactly where extra records are being created and why they don't match the expected final state.
