# Auth Provider Refactor Design
_2026-04-11_

## Problem

The current `IndexedDbBridge` component conflates four distinct responsibilities:
- Reading IndexedDB
- Opening SQLite
- Managing the auth token
- Connecting the socket

The auth token (`token`, `keyHash`) is incorrectly stored in IndexedDB when it belongs exclusively in SQLite. The bootstrap order (IDB → socket in parallel with SQLite) means the socket token comes from IDB rather than the encrypted SQLite store.

## Goal

Separate auth concerns into a layered provider chain with clear boundaries:

```
IndexedDbProvider → AuthProvider → DbsProvider → TokenProvider → SocketProvider
```

Each provider has one job. Token never touches IDB.

---

## Component Chain

### `IndexedDbProvider`
**Responsibility:** thin CRUD wrapper over the IDB `mxdb_authentication` store.

- Reads/writes `{ id, credentialId, dbName, isDefault }` — no token, no keyHash, no encryptionKey
- Provides `IndexedDbContext`:
  ```typescript
  interface IndexedDbContextValue {
    getDefault(): Promise<IDBAuthEntry | undefined>;
    saveEntry(entry: IDBAuthEntry): Promise<void>;
    clearDefault(): Promise<void>;
  }

  interface IDBAuthEntry {
    id: string;
    credentialId: Uint8Array;
    dbName: string;
    isDefault: boolean;
  }
  ```
- No business logic — purely a React wrapper over `IndexedDbAuthStore`

---

### `AuthProvider`
**Responsibility:** WebAuthn, invite/registration flow, authentication state, encryption key lifecycle.

- On mount: calls `IndexedDbContext.getDefault()`. If an entry exists, performs a WebAuthn PRF assertion using `credentialId` to derive `encryptionKey`.
- `isAuthenticated` = `encryptionKey != null`
- When authenticated: renders `DbsProvider` (with `encryptionKey`) → `TokenProvider` (with `initialAuth` if just registered) → `SocketProvider` → `children`
- When unauthenticated: renders `children` directly (app can show login UI)
- Provides `AuthContext`:
  ```typescript
  interface AuthContextValue {
    isAuthenticated: boolean;
    signOut(): void;
    register(url: string, options?: RegisterOptions): Promise<{ userDetails: MXDBUserDetails }>;
  }
  ```
- `signOut()`: clears `encryptionKey` from state. Everything below (`DbsProvider`, `TokenProvider`, `SocketProvider`) unmounts cleanly. IDB entry is **not** cleared — user re-authenticates via WebAuthn on next visit.
- `register(url)`: full invite flow — HTTP registration, WebAuthn credential creation, PRF key derivation, keyHash computation, server token retrieval, IDB save. Stores `pendingAuth: { token, keyHash }` in state for `TokenProvider`.

**Where invite logic lives:** `AuthProvider` owns the `register` method. `useMXDBInvite` is a thin hook that calls `AuthContext.register(url)`.

---

### `DbsProvider`
**Responsibility:** open and manage the SQLite database. **Unchanged.**

- Receives `encryptionKey` and `dbName` as props (from `AuthProvider`)
- Opens the encrypted SQLite DB; provides `DbsContext` with db instances
- When `AuthProvider` clears `encryptionKey`, it stops rendering `DbsProvider` → db closes on unmount

---

### `TokenProvider`
**Responsibility:** read and write the auth token within SQLite. Internal — not exported.

- Calls `useDb()` → `db.readAuth()` on mount to load `{ token, keyHash }`
- If SQLite is empty and `initialAuth` prop is provided (post-registration): writes it to SQLite immediately and uses it
- Renders `SocketProvider` with `token`, `keyHash`, and `onTokenRotated` callback as props
- `onTokenRotated(newToken)`: calls `db.writeAuth(newToken, keyHash)`, updates internal token state (so subsequent socket reconnects use the latest token)
- No context — token flows via props only

---

### `SocketProvider`
**Responsibility:** socket connection and token rotation. Internal — not exported.

- Props: `name`, `host`, `token`, `keyHash`, `onTokenRotated(newToken: string)`
- Renders `SocketAPI` with `auth={{ token, keyHash }}`
- Listens to `mxdbTokenRotated` event internally (no separate `TokenRotationProvider`)
- On receiving new token: updates `socket.auth` for reconnects, calls `onTokenRotated(newToken)`
- Renders `ClientToServerSyncProvider`, `ClientToServerProvider`, `ServerToClientProvider` internally, then `{children}`

---

## Data Flow

### Normal startup
```
Mount
  → IndexedDbProvider reads IDB → credentialId, dbName
  → AuthProvider: WebAuthn assertion → encryptionKey derived
  → DbsProvider opens SQLite with encryptionKey
  → TokenProvider: db.readAuth() → token, keyHash
  → SocketProvider connects with token
```

### Token rotation
```
Server emits mxdbTokenRotated(newToken)
  → SocketProvider receives event
  → SocketProvider calls onTokenRotated(newToken)
  → TokenProvider: db.writeAuth(newToken, keyHash) + updates state
  → SocketProvider updates socket.auth for future reconnects
```

### Registration (first time)
```
useMXDBInvite calls AuthContext.register(url)
  → HTTP: get registrationToken + userDetails
  → WebAuthn credential created → PRF → encryptionKey, keyHash
  → HTTP POST: get server token
  → IndexedDbContext.saveEntry({ id, credentialId, dbName }) — no token
  → AuthProvider sets encryptionKey + pendingAuth={ token, keyHash }
  → DbsProvider opens (new dbName)
  → TokenProvider mounts: SQLite empty + initialAuth provided → writes to SQLite → proceeds normally
  → On subsequent mounts, db.readAuth() finds the token; initialAuth prop is ignored (SQLite not empty)
```

### Sign-out
```
useMXDBSignOut calls AuthContext.signOut()
  → AuthProvider clears encryptionKey
  → DbsProvider unmounts → SQLite closes
  → TokenProvider unmounts
  → SocketProvider unmounts → socket disconnects
  → AuthProvider renders children directly (unauthenticated)
  → IDB entry intact → user re-authenticates via WebAuthn next visit
```

---

## File Changes

| File | Action |
|---|---|
| `src/client/auth/IndexedDbBridge.tsx` | → `IndexedDbProvider.tsx` (major rewrite) |
| `src/client/auth/IndexedDbAuthStore.ts` | Remove `token`, `keyHash`, `updateDefaultToken` |
| `src/client/auth/AuthTokenContext.ts` | → Delete; replaced by `IndexedDbContext.ts` + `AuthContext.ts` |
| `src/client/auth/AuthProvider.tsx` | New |
| `src/client/auth/TokenProvider.tsx` | New (internal) |
| `src/client/auth/SocketProvider.tsx` | New (internal, replaces SocketAPI wiring in IndexedDbBridge) |
| `src/client/auth/SqliteTokenSync.tsx` | Delete |
| `src/client/auth/TokenRotationProvider.tsx` | Delete (logic moves to SocketProvider) |
| `src/client/MXDBSync.tsx` | Simplified — renders `IndexedDbProvider` > `AuthProvider` (which internally composes `DbsProvider` > `TokenProvider` > `SocketProvider` > children) |
| `src/client/hooks/useMXDBInvite.ts` | Delegates to `AuthContext.register()` |
| `src/client/hooks/useMXDBSignOut.ts` | Uses `AuthContext.signOut()` |
| `src/client/hooks/useMXDBAuth.ts` | Uses `AuthContext.isAuthenticated` |
| `src/client/providers/dbs/DbsProvider.tsx` | No changes |

---

## Invariants

- Token never stored in IndexedDB
- IDB stores only: `{ id, credentialId, dbName, isDefault }`
- Token never in React context — flows via props between `TokenProvider` ↔ `SocketProvider`
- Sign-out does not touch IDB — only clears the in-memory encryption key
- `TokenProvider` and `SocketProvider` are internal — not exported from the package
