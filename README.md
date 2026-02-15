# MXDB-Sync

MXDB-Sync syncs MongoDB-backed collections with clients over a real-time connection (Socket.IO). You define collections once in shared code, use them on the client with React hooks and sync, and on the server with actions, subscriptions, and lifecycle hooks.

## Package exports

- **`@anupheaus/mxdb-sync/common`** – Shared types and collection definitions.
- **`@anupheaus/mxdb-sync/server`** – Server startup, collections API, and extension hooks.
- **`@anupheaus/mxdb-sync/client`** – React provider, hooks, and sync.

## Architecture

The library is split into three layers:

| Layer   | Role |
|--------|------|
| **Common** | Define collections with `defineCollection(config)`. Config includes `name`, `version`, `indexes`, and options like `disableSync` / `disableAudit`. Shared by client and server. |
| **Client** | Wrap the app in `<MXDBSync>`, then use `useCollection(collection)` for get/upsert/remove/query/distinct and real-time updates. Optional `useRecord()` and `useMXDBSync()` for connection/sync state. |
| **Server** | Call `startServer(config)` with MongoDB URL, collection list, and optional seeding. Use `extendCollection(collection, hooks)` to add onBefore/onAfter hooks and `onSeed`. |

The server exposes actions (upsert, remove, get, getAll, query, distinct, sync) and subscriptions; the client talks to them over the socket and keeps local DBs in sync. Change notifications are driven by the MongoDB change stream.

## Server setup

```ts
import { startServer } from '@anupheaus/mxdb-sync/server';
import { collections } from './collections';
import './configureExtensions'; // extendCollection(...)

const { app } = await startServer({
  name: 'my-app',
  logger,
  collections,
  server: httpServer,
  mongoDbName: 'mydb',
  mongoDbUrl: process.env.MONGO_URI,
  shouldSeedCollections: true,
  changeStreamDebounceMs: 20,
});
```

**ServerConfig** (relevant options):

- **collections** – Array of collections returned from `defineCollection()`.
- **mongoDbName**, **mongoDbUrl** – MongoDB connection.
- **shouldSeedCollections** – If true, runs seeding on startup (see Extension hooks / onSeed).
- **changeStreamDebounceMs** – Idle window (ms) before change-stream events are dispatched; events within this window are batched. Default `20`.

You can pass additional options through to the underlying socket server (e.g. **actions**, **subscriptions**, **onStartup**, **onClientConnected**, **onClientDisconnected**).

## Client setup

```tsx
import { MXDBSync, useCollection, useMXDBSync } from '@anupheaus/mxdb-sync/client';
import { collections } from './collections';

function App() {
  return (
    <MXDBSync name="my-app" collections={collections} host={socketHost}>
      <Content />
    </MXDBSync>
  );
}

function Content() {
  const { get, getAll, upsert, remove, query, useGet, useQuery, useDistinct, onChange } = useCollection(myCollection);
  const { isConnected, clientId, isSynchronising } = useMXDBSync();
  // ...
}
```

**MXDBSync** props: **name** (must match server), **collections**, optional **host**, **logger**, **onInvalidToken**, **onUnauthorisedOperation**.

**useCollection(collection)** returns: **get**, **getAll**, **upsert**, **remove**, **query**, **distinct**, **find**, **useGet**, **useQuery**, **useDistinct**, **tableRequest**, **useSubscription**, **onChange**, **config**.

## Extending collections (server)

Use **extendCollection(collection, hooks)** on the server to add lifecycle hooks and seeding. Hooks run in the db context and can use the server’s **useCollection()** for cross-collection access.

### onBefore / onAfter hooks

- **onBeforeDelete**, **onBeforeUpsert** – Run only on the server instance that performs the operation (in the action), before the write. Use for validation or pre-write side effects.
- **onAfterDelete**, **onAfterUpsert** – Run when a change is observed from the **MongoDB change stream**, so they run on every instance watching the stream (including when another instance or process performed the write). Use for cross-collection updates or other reactions.

Clients are notified of a change only **after** the onAfter hooks for that change have completed: the stream dispatch runs onAfter hooks first, then notifies subscribers.

### onSeed and seedWith

**onSeed(seedWith)** runs at startup when **shouldSeedCollections** is true. It receives **seedWith**, which you call with **SeedWithProps**: e.g. **count** and **create()** to ensure a minimum number of records, or **fixedRecords** (and optional **count**) for fixed data. Use the server’s **useCollection()** for other collections inside onSeed.

```ts
extendCollection(products, {
  onSeed: async seedWith => {
    await seedWith({
      count: 10,
      create: () => ({ id: Math.uniqueId(), name: '', ... }),
    });
  },
});
```

## Change stream and notification order

Change stream events are batched per collection and operation type. After no events have arrived for **changeStreamDebounceMs** (default 20 ms), the batch is dispatched: extension onAfter hooks run first, then change callbacks (e.g. client sync).

When an onAfter hook updates **other** records (e.g. cascade or reference cleanup), those updates are separate writes and produce **separate** change-stream events. Each is batched independently. There is no cross-collection ordering guarantee.

**Example: Record A references Record B; User X deletes Record B**

1. Record B is deleted; the change stream sees the delete.
2. After the debounce window, the server runs **onAfterDelete** for collection B. That hook updates Record A to remove the reference to B (upsert to collection A).
3. Clients (e.g. User Y) are then notified of **“Record B deleted”**.
4. The upsert to Record A is a **separate** change-stream event (collection A, update), batched independently.
5. When that batch is dispatched, clients are notified of **“Record A updated”**.

So **User Y receives the deletion of B before the update to A**. There can be a brief period where the client has been told “B deleted” but Record A still appears to reference B until the A-update notification arrives. If the UI must avoid that, handle it on the client (e.g. treat a missing referenced record as “unset” until the cascade update arrives).

## Development and test app

- **Build**: `npm run build`
- **Server**: `npm run server` (uses test server entry; set `MONGO_DB_URI`, `MONGO_DB_NAME`, etc.)
- **Client**: `npm run client`
- **Tests**: `npm test`

The **test/** folder contains a small app: shared **common** collections (e.g. addresses, products), **test/server** (startServer, configureExtensions, configureActions, views), and **test/client** (MXDBSync, useCollection, Addresses, etc.). Use it as a reference for wiring server and client.

## License

Apache-2.0
