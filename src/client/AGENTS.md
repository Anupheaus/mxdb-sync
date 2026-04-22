# Client layer (`src/client/`)

React provider, hooks, SQLite-backed local store, and client-side sync.

## Overview

The client layer wraps the app in `<MXDBSync>` (the root provider), exposes `useCollection` for all collection operations, and handles offline-first storage, real-time updates, WebAuthn auth, and conflict resolution.

Local state lives in a per-device SQLite database (OPFS shared worker in browsers, in-memory in Node/tests). The `dbs` provider owns this database. Sync to/from the server flows through `client-to-server` and `server-to-client` providers which wrap the sync-engine's `ClientDispatcher` and `ClientReceiver`.

## Contents

### Root exports
- `MXDBSync.tsx` — root React provider; mount once at app root. Accepts `collections`, `host`, auth callbacks, error handlers.
- `useMXDBSync.ts` — `useMXDBSync()` — connection state: `isConnected`, `clientId`, `isSynchronising`, test disconnect helpers
- `useRecord.ts` — `useRecord(id | localCopy, collection)` — optimistic form-edit hook with server-rebase semantics
- `internalModels.ts` — client-private types

### Hooks (`hooks/`)
- `useCollection(collection)` — primary API (imperative + reactive). See [hooks/useCollection/AGENTS.md](hooks/useCollection/AGENTS.md).
- `useAuth()` — auth state for the current device
- `useMXDBSignOut()` — sign out of current device
- `useMXDBUserId()` — current user id

### Local database (`db-worker/`)
SQLite worker architecture. See [db-worker/AGENTS.md](db-worker/AGENTS.md).

### Providers (`providers/`)
React context providers composing the `MXDBSync` tree. See [providers/AGENTS.md](providers/AGENTS.md).

### Auth (`auth/`)
- `deriveKey.ts` — WebAuthn PRF extension key derivation; used to encrypt the auth token at rest in SQLite

### Components (`components/UseRecord/`)
- `UseRecordContext.ts` / `useRecord.ts` — implementation backing the `useRecord` hook

## Architecture

`MXDBSync` mounts a nested provider stack (socket → dbs → collection → C2S → S2C → conflictResolution). Order matters: providers lower in the tree access context from providers mounted above them. The `dbs` provider must sit above all collection and sync providers.

## Related

- [hooks/useCollection/AGENTS.md](hooks/useCollection/AGENTS.md) — collection API
- [db-worker/AGENTS.md](db-worker/AGENTS.md) — SQLite worker
- [providers/AGENTS.md](providers/AGENTS.md) — React provider tree
- [../common/AGENTS.md](../common/AGENTS.md) — shared types and sync engine
