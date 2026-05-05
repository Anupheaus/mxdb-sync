# Server hooks (`src/server/hooks/`)

Server-side hook utilities and factory functions for typed collection access within socket request contexts.

## Overview

Server hooks are plain functions (not React hooks) that run inside socket action handlers and subscriptions, where a request-scoped context (socket id, user, db connection) is implicitly available. They wrap the server `useCollection` primitive with strongly-typed, named APIs, hydration, helpers, and extensions — mirroring the client factory hooks but returning async functions instead of React hooks.

## Contents

### Factory hooks

#### `useRecord/` — single-record async factory
- `createUseRecord(name, collection, options)` — creates an async function `useXxx(id, ...args)` that loads a record by id, hydrates it, and returns `{ xxx, upsertXxx, removeXxx, isNewXxx, ...helpers }`.
  - `options.hydrateRecord(loadedRecord, ...args)` — synchronous; derives/fills defaults on the loaded record. Receives `undefined` when no record exists.
  - `options.helpers(baseResult)` — synchronous; derives additional values from the base result.
  - `options.extensions` — static methods attached to the returned function.
  - No `setXxx`, no `isLoadingXxx`, no `autoSaveXxx` — server writes are always explicit; there's no React state.
- `ServerUseRecord<Name, T, Helpers>` — result type.
- `CreateUseRecordOptions<...>` / `CreateUseRecord<...>` — option and utility types.

#### `useRecords/` — multi-record sync factory + async query
- `createUseRecords(name, collection, options?)` — creates a sync function `useXxx()` returning `{ queryXxx, getAllXxx, upsertXxx, removeXxx, getXxx, findXxx, distinctXxx, ...helpers }`, plus an async static method `useXxx.query(...)`.
  - `queryXxx(props?: QueryProps<T>)` — async instance method on the returned object; takes optional `QueryProps` only (no ids-array overload). Returns `{ xxx[], totalXxx }`.
  - `getXxx(id: string)` — returns `Promise<T | undefined>` for a single record.
  - `getXxx(ids: string[])` — returns `Promise<T[]>` for multiple records. Both overloads delegate directly to `col.get`.
  - `useXxx.query()` — async static method with three overloads: no-args, ids array `(T | string)[]`, or `QueryProps<T>`. Returns `{ xxx[], totalXxx }`.
  - `options.additionalQueryProps` — default query props merged as a base; caller-supplied props win. The computed `$in` filter (from the ids-array overload) always wins over `additionalQueryProps.filters`. Note: `disable` is excluded from this type (not meaningful server-side).
  - `options.helpers(baseResult)` — derives additional values merged into the `useXxx()` result. Receives the full `ServerUseRecords` object as context.
  - `options.extensions` — static methods on the hook function.
- `ServerUseRecords<Name, T, Helpers>` / `ServerUseRecordsQuery<Name, T>` — result types.
- `CreateUseRecordsOptions<...>` / `CreateUseRecords<...>` — option and utility types.

### Context hooks
- `useAuditor.ts` — `useAuditor(fullAudit: boolean)` — returns audit utilities scoped to a collection's audit mode. Exposes `isAudit(value)` (type guard), `merge(serverAudit, clientAudit)` (reconciles client/server audit shapes), `fullAudit` flag, and the base `auditor` helpers. Not socket-context dependent — takes the `fullAudit` boolean directly (from the collection definition's `disableAudit` flag).
- `useClient.ts` — `useClient()` — extends `useSocketAPI()` with mxdb-specific helpers. Returns: `getClient()` (current socket client), auth methods (from socket-api), `wrapWithSocketAPI(fn)`, `config`, `getLogger(subLoggerName?)` (creates a per-client sub-logger), `isDataAvailable` / `getData` / `setData` (subscription data store helpers for managing per-subscription state).

## Architecture

**Request-scoped context:** All server hooks call `useCollection(collection)` internally, which accesses the socket-api context hooks (`useDb`, `useLogger`) that are injected per request. The hooks must be called within an active socket handler — not during startup or in setTimeout/setImmediate callbacks.

**`useXxx()` is sync, `useXxx.query()` is async:** The `useXxx()` call (from `createUseRecords`) only constructs references to the collection methods — it does not await anything. The `useXxx.query()` method awaits the MongoDB query. Choose accordingly: use `useXxx()` to get method references you'll call later; use `useXxx.query()` when you need results immediately.

**`RemoveDasherized` key mapping:** Same convention as the client — `'order-item'` produces `orderItems`, `upsertOrderItem`, `totalOrderItems`, etc. at both the type level and runtime.

## Ambiguities and gotchas

- **No React hooks:** Server factories do not use `useState`, `useRef`, `useMemo`, or any React hook. They're named `use*` by convention (consistent with the client API surface) but they're plain functions safe to call outside of React render cycles.
- **`isNew` semantics:** `isNewXxx` in `createUseRecord` is `true` when no persisted record was found — even if `hydrateRecord` returns a fully populated object with a generated id. It reflects persistence state, not whether the record object exists.
- **`upsertXxx` in server `createUseRecord` accepts one record only** — it wraps `useCollection().upsert` with a single-record signature. Use the `queryXxx` / `upsertXxx` from `createUseRecords` if you need batch operations.
- **`useXxx.query()` calls `useCollection()` inside the async function** — the socket context must still be active when `.query()` is awaited, not just when `.query()` is first called.

## Related

- [../collections/AGENTS.md](../collections/AGENTS.md) — server `useCollection` primitive used by both factories
- [../../client/hooks/AGENTS.md](../../client/hooks/AGENTS.md) — client-side counterparts (`createUseRecord` / `createUseRecords` as React hooks)
- [../../common/models/hookModels.ts](../../common/models/hookModels.ts) — shared types: `RecordTypeOfCollection`, `ExtensionsType`, `RemoveDasherized`
