# Server collections API (`src/server/collections/`)

`extendCollection` and the server-side `useCollection` accessor.

## Overview

`extendCollection` is the server's primary extension point: it attaches lifecycle hooks and optional seeding to a collection. `useCollection` provides a read/write accessor for use inside hooks and actions.

## Contents

- `extendCollection.ts` — `extendCollection(collection, hooks)` — registers hooks in a module-level registry; `ServerDbCollectionEvents` reads them when wiring change-stream callbacks
- `useCollection.ts` — `useCollection(collectionName)` — returns `{ collection, getAll, get, find, query, upsert, remove, distinct, onChange, removeOnChange }`; use inside `onAfter*` hooks for cross-collection cascades
- `index.ts` — re-exports both

## Available hooks

| Hook | When | Notes |
|------|------|-------|
| `onBeforeUpsert({ records })` | Before write, on originating instance | Use for validation |
| `onAfterUpsert({ records, insertedIds, updatedIds })` | After change stream, on all instances | Use for cascades |
| `onBeforeDelete({ recordIds })` | Before write, on originating instance | Use for validation |
| `onAfterDelete({ recordIds })` | After change stream, on all instances | Use for cascades |
| `onBeforeClear({ collectionName })` | Before clear, on originating instance | — |
| `onAfterClear({ collectionName })` | After clear, on originating instance only | Not change-stream driven |
| `onSeed(seedWith)` | At startup if `shouldSeedCollections: true` | — |

## Architecture

`extendCollection` may be called before `startServer` — hook registration is fire-and-forget into a module-level `Map`. The registry is read by `ServerDbCollectionEvents` during `startServer` when it wires change-stream callbacks per collection.

## Ambiguities and gotchas

- **`onAfter*` (upsert/delete) run on every instance watching the change stream** — not just the one that originated the write. Do not rely on request-scoped context (user, socket) inside them; use `onBefore*` for that.
- **`onAfterClear` is not change-stream driven** — it runs only on the instance that performed the clear. This asymmetry is intentional and documented in `README.md`.
- **`useCollection` inside hooks** — `onAfter*` hooks run outside socket request context. Use `useCollection` for cross-collection reads/writes; do not attempt to access user/socket context here.

## Related

- [../AGENTS.md](../AGENTS.md) — parent server directory
- [../providers/db/AGENTS.md](../providers/db/AGENTS.md) — `ServerDbCollectionEvents` invokes hooks
- [../subscriptions/AGENTS.md](../subscriptions/AGENTS.md) — subscriptions also use `useCollection`
