# SQLite dbs provider (`src/client/providers/dbs/`)

Manages per-device SQLite databases — one `Db` per `MXDBSync` instance, one `DbCollection` per registered collection.

## Overview

The `dbs` provider creates and holds the `Db` instance which in turn owns a `SqliteWorkerClient`. Every collection operation performed via `useCollection` ultimately calls a `DbCollection` method here. The provider also maintains an in-memory copy of each collection's current records so that reactive hooks can read synchronously without hitting SQLite.

## Contents

### Provider / context
- `Dbs.ts` / `DbsProvider` — React provider; creates `Db` on mount, tears it down on unmount
- `DbContext.ts` / `useDb()` — context hook returning the `Db` instance

### Database classes
- `Db.ts` — per-device database; wraps `SqliteWorkerClient`, creates `DbCollection` per config, wires `setOnExternalChange` for cross-tab reload
- `DbCollection.ts` — per-collection API: `get`, `getAll`, `find`, `query`, `upsert`, `remove`, `onChange`, `reloadFromWorker`, `sync` (used by C2S/S2C providers to apply sync-engine results)

### Data transformation
- `transforms.ts` — (de)serialise records between JS objects and SQLite rows; handles Luxon `DateTime` ↔ ISO string, nested objects ↔ JSON column
- `transforms.tests.ts` — unit tests for serialisation edge cases

### Models and utilities
- `models.ts` — `MXDBCollectionEvent` (change notification shape)
- `utils.ts` — internal helpers (e.g. audit entry encoding for SQLite)
- `dbs-consts.ts` — shared constants (column names, table suffixes)

## Architecture

`Db` is created once at mount. It calls `SqliteWorkerClient.open()` with the DDL for all configured collections. Once open, each `DbCollection` exposes both a synchronous in-memory read layer (for reactive hooks) and async SQLite-backed write/read methods.

The in-memory layer is refreshed on every write (local or incoming S2C). `reloadFromWorker()` re-reads from SQLite when a `SharedWorker` signals that another browser tab has written to the database.

## Ambiguities and gotchas

- **`DbCollection.sync()`** is called by the C2S/S2C providers to apply a `MXDBUpdateRequest` batch from the sync engine. It is not part of the public `useCollection` API.
- **Luxon `DateTime` is stored as ISO strings** in SQLite. Always go through `transforms.ts`; do not write raw values to the SQLite layer.
- **Auth table** — `Db` creates an internal `mxdb_authentication` table on open alongside the user-defined collection tables. It stores the encrypted auth token and is never exposed through `DbCollection`.

## Related

- [../../db-worker/AGENTS.md](../../db-worker/AGENTS.md) — `SqliteWorkerClient` used by `Db`
- [../../hooks/useCollection/AGENTS.md](../../hooks/useCollection/AGENTS.md) — all collection ops call into `DbCollection`
- [../AGENTS.md](../AGENTS.md) — parent providers directory
