# Server layer (`src/server/`)

`startServer`, MongoDB persistence, server-side sync, WebAuthn auth, lifecycle hooks.

## Overview

Exposes one public function (`startServer`) and one composable extension hook (`extendCollection`). Internally it wires Socket.IO actions/subscriptions, a MongoDB persistence layer, change-stream-driven S2C notifications, and a WebAuthn/invite-link auth flow.

## Contents

### Entry points
- `startServer.ts` — `startServer(config)` — main async init; connects to MongoDB, starts socket server, returns `ServerInstance`
- `startAuthenticatedServer.ts` — inner bootstrap called by `startServer`; wires auth namespace, socket actions, and Koa

### Collections API (`collections/`)
`extendCollection` (lifecycle hooks + seeding) and `useCollection` (server-side collection accessor). See [collections/AGENTS.md](collections/AGENTS.md).

### Socket actions (`actions/`)
Handlers for C2S socket calls: `get`, `getAll`, `query`, `distinct`, `clientToServerSync`, `reconcile`. See [actions/AGENTS.md](actions/AGENTS.md).

### Subscriptions (`subscriptions/`)
Server-side reactive subscriptions: `getAll`, `query`, `distinct`. See [subscriptions/AGENTS.md](subscriptions/AGENTS.md).

### MongoDB persistence (`providers/db/`)
`ServerDb`, `ServerDbCollection`, change stream, `DbContext`. See [providers/db/AGENTS.md](providers/db/AGENTS.md).

### Auth (`auth/`)
- `AuthCollection.ts` — MongoDB collection storing device registrations and pending invite tokens
- `InviteNamespace.ts` — Socket.IO namespace for the WebAuthn invite-link handshake
- `deviceManagement.ts` — `getDevices`, `enableDevice`, `disableDevice`
- `useAuth.ts` — server-side hook: `userId`, `token` for the current socket context
- `registerDevAuthRoute.ts` — dev-only bypass auth route; excluded when `NODE_ENV=production`

### Audit (`audit/`)
- `toServerAuditOf.ts` — promotes a client `AuditOf` to `ServerAuditOf` by adding `socketId`, `timestamp`

### Hooks (`hooks/`)
- `useAuditor.ts` — server-side hook providing auditor helpers
- `useClient.ts` — hook exposing client-specific socket context data (client id, user)

### S2C synchronisation
- `ServerToClientSynchronisation.ts` — per-socket `ServerDispatcher` lifecycle; receives change-stream events and pushes S2C cursors to connected clients

### Seeding (`seeding/`)
- `seedCollections.ts` — called at startup when `shouldSeedCollections: true`; runs `onSeed` hooks
- `seededData.ts` — tracks seeded record ids to prevent duplicate seeding across restarts

### Utilities / internal
- `subscriptionDataStore.ts` — per-client key-value store used by subscriptions to track prior data (e.g. previous record ids for getAll diffs)
- `clientDbWatches.ts` — tracks which clients are subscribed to which collections
- `internalModels.ts` — `ServerConfig` and `ServerInstance` type definitions

## Architecture

`startServer` wires everything in order:
1. `provideDb` — connects MongoDB, opens `ServerDb`, starts change stream
2. `startAuthenticatedServer` — starts Socket.IO, registers auth namespace, mounts actions and subscriptions
3. Per-socket: `ServerReceiver` + `ServerDispatcher` created on connect, destroyed on disconnect

## Ambiguities and gotchas

- **`onAfterUpsert` / `onAfterDelete` are change-stream driven** — they run on every server instance watching the stream, not just the one that originated the write. Use `onBefore*` for per-request validation.
- **`registerDevAuthRoute` is excluded in production** — do not rely on it in prod builds.
- **`close()` on `ServerInstance`** terminates the MongoDB connection. Required for clean test teardown; neglecting it causes open handle warnings in Vitest.

## Related

- [collections/AGENTS.md](collections/AGENTS.md) — extendCollection and useCollection
- [actions/AGENTS.md](actions/AGENTS.md) — socket action handlers
- [subscriptions/AGENTS.md](subscriptions/AGENTS.md) — server-side subscriptions
- [providers/db/AGENTS.md](providers/db/AGENTS.md) — MongoDB persistence
- [../common/AGENTS.md](../common/AGENTS.md) — shared types and sync engine
