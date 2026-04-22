# Client providers (`src/client/providers/`)

React context providers that compose the `MXDBSync` provider tree.

## Overview

Each subdirectory is a self-contained provider responsible for one concern. `MXDBSync` mounts them in order; providers deeper in the tree can access context from providers mounted above them.

Mount order (outermost → innermost): socket (socket-api) → `dbs` → `collection` → `client-to-server` → `server-to-client` → `conflictResolution`.

## Contents

### `dbs/` — SQLite database provider
Owns per-device `Db` and per-collection `DbCollection` instances; exposes `useDb()`. See [dbs/AGENTS.md](dbs/AGENTS.md).

### `collection/` — active collection context
- `CollectionContext.ts` / `useCurrentCollection()` — makes the active `DbCollection` available to hooks within a `<CollectionProvider>` subtree

### `client-to-server/` — C2S sync provider
- `ClientToServerSynchronisation.ts` — thin wrapper around `ClientDispatcher` (sync engine); batches pending local changes and dispatches to the server on a timer
- `SyncStateContext.ts` / `useClientToServerSyncInstance()` — exposes the `ClientDispatcher` instance and sync state

### `server-to-client/` — S2C sync provider
- `ServerToClientProvider.ts` — registers the `ClientReceiver` (sync engine) for incoming server pushes
- `ClientReceiverContext.ts` — exposes the `ClientReceiver` to children

### `conflictResolution/` — conflict resolution context
- `ConflictResolutionContext.ts` — holds the `onConflictResolution` callback from `MXDBSync` props; exposed to hooks that need to prompt the user when a server deletion conflicts with local pending changes

## Architecture

The C2S and S2C providers are tightly coupled through the sync engine: `ClientDispatcher` pauses the `ClientReceiver` before each dispatch to prevent concurrent C2S/S2C races. See [sync-engine/AGENTS.md](../../common/sync-engine/AGENTS.md) for the full interaction.

## Related

- [dbs/AGENTS.md](dbs/AGENTS.md) — SQLite DB management
- [../AGENTS.md](../AGENTS.md) — parent client directory
- [../../common/sync-engine/AGENTS.md](../../common/sync-engine/AGENTS.md) — CD/CR components wired here
