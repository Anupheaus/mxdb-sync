# Design: `useAuth` — Server & Client Auth Context

**Date:** 2026-04-15
**Status:** Approved

## Overview

Wire a unified `useAuth()` hook on both the server and client so that server-side action/subscription handlers can access the current user's full details, and client components have a consistent auth API. Simultaneously extend `MXDBUserDetails` with an `id` field and add lifecycle callbacks to `ServerConfig` for connection/disconnection events.

---

## 1. `MXDBUserDetails` extends `Record`

**File:** `src/common/models/authModels.ts`

Add `extends Record` from `@anupheaus/common`, which contributes `id: string`. The existing index signature `[key: string]: unknown` is retained to allow app-specific fields.

```ts
import type { Record } from '@anupheaus/common';

export interface MXDBUserDetails extends Record {
  name: string;
  displayName?: string;
  [key: string]: unknown;
}
```

`id` is the `userId` from the auth record — the same string passed to `onGetUserDetails`.

---

## 2. Server async auth context

**New file:** `src/server/auth/useAuth.ts`

### Mutable state shape

```ts
interface MutableAuthState {
  user: MXDBUserDetails;       // updated in place by refresh()
  deviceInfo: MXDBDeviceInfo;  // static for the lifetime of the connection
  socket: Socket;              // internal — not exposed via useAuth()
  signedOut: boolean;          // set to true before voluntary disconnect
}
```

### Storage

Two parallel stores for the same object reference:

- **`WeakMap<Socket, MutableAuthState>`** — used in `onClientDisconnected`, where only the raw `Socket` is available (async context is no longer live).
- **`createAsyncContext({ authState: optional<MutableAuthState>() })`** — used inside action/subscription handlers, following the same pattern as `DbContext`.

Both point to the same mutable object, so `refresh()` mutating `state.user` is immediately visible everywhere.

### Population

In `startAuthenticatedServer.ts`, after successful token validation:

1. Call `onGetUserDetails(record.userId)` to fetch the full user details.
2. Build `MutableAuthState` with `{ user: { ...userDetails, id: record.userId }, deviceInfo, socket: client, signedOut: false }`.
3. Store in `WeakMap` keyed by `client`.
4. Call `setAuthState(state)` to set it in the async context for this connection.

---

## 3. Server `useAuth()`

**Exported from:** `src/server/index.ts`

```ts
const { user, deviceInfo, refresh, signOut } = useAuth();
```

| Member | Type | Description |
|---|---|---|
| `user` | `MXDBUserDetails` | Live reference — reflects latest `refresh()` call |
| `deviceInfo` | `MXDBDeviceInfo` | Static for the lifetime of the connection |
| `refresh()` | `() => Promise<void>` | Calls `onGetUserDetails(user.id)` and updates `state.user` in place |
| `signOut()` | `() => void` | Sets `state.signedOut = true`, calls `socket.disconnect(true)` — does **not** disable the device |

Throws if called outside an authenticated request context (no auth state in the async context).

---

## 4. `ServerConfig` lifecycle callbacks

**File:** `src/server/internalModels.ts`

Two new optional callbacks:

```ts
onConnected?(ctx: {
  user: MXDBUserDetails;
  deviceInfo: MXDBDeviceInfo;
}): PromiseMaybe<void>;

onDisconnected?(ctx: {
  user: MXDBUserDetails;
  deviceInfo: MXDBDeviceInfo;
  reason: 'signedOut' | 'connectionLost';
}): PromiseMaybe<void>;
```

**`onConnected`** — fired at the end of `onClientConnected` in `startAuthenticatedServer.ts`, after auth state has been built and the async context is set.

**`onDisconnected`** — fired in `onClientDisconnected`. Uses the `WeakMap` to look up auth state by socket. If no auth state exists (unauthenticated socket), the callback is silently skipped. `reason` is `'signedOut'` if `state.signedOut === true`, otherwise `'connectionLost'`.

---

## 5. Client sign-out action (`mxdbSignOutAction`)

**File:** `src/common/internalActions.ts`

```ts
export const mxdbSignOutAction = defineAction<void, void>()('mxdbSignOutAction');
```

**Server handler** (new file `src/server/actions/signOutAction.ts`):
1. Calls `useAuth().signOut()` — which sets `signedOut = true` and disconnects the socket.
2. This triggers `onClientDisconnected` → `onDisconnected` with `reason: 'signedOut'`.

**Client** — `AuthProvider.signOut()` fires `mxdbSignOutAction` before clearing local session state (encryption key, dbName, pendingAuth). Fires and forgets — no need to await the disconnect.

---

## 6. `mxdbUserAuthenticated` event extended

**File:** `src/common/internalEvents.ts`

The `mxdbUserAuthenticated` event payload gains `userDetails: MXDBUserDetails`:

```ts
// before
{ userId: string }

// after
{ userId: string; userDetails: MXDBUserDetails }
```

**Server side** — in `startAuthenticatedServer.ts`, the server calls `onGetUserDetails(record.userId)` and includes the result in the event emission. (The result is also stored in `MutableAuthState`, so `onGetUserDetails` is called exactly once per connection.)

**Client side** — `AuthProvider` already listens for this event to set `userId`. It now also stores `userDetails` in state and provides it through `AuthContext`.

---

## 7. Client `useAuth()` — rename + extend

### File rename

`src/client/hooks/useMXDBAuth.ts` → `src/client/hooks/useAuth.ts`

### Type rename

`UseMXDBAuthResult` → `UseAuthResult`

### New return shape

```ts
export interface UseAuthResult {
  isAuthenticated: boolean;
  user: MXDBUserDetails | undefined;  // undefined until authenticated
  signOut(): void;
}

export function useAuth(): UseAuthResult { ... }
```

`user` is populated from `AuthContext`, which is updated when `mxdbUserAuthenticated` is received.

### `AuthContext` changes

`AuthContextValue` gains `user: MXDBUserDetails | undefined`.

`AuthProvider` manages a `user` state variable (initially `undefined`), sets it when the `mxdbUserAuthenticated` event arrives, and clears it on `signOut()`.

### Index re-export

`src/client/hooks/index.ts` — export updated from `useMXDBAuth` to `useAuth`.

### Test file

`src/client/auth/hooks.tests.tsx` — all `useMXDBAuth` references updated to `useAuth` / `UseAuthResult`.

---

## Data flow summary

```
Client connects
  └─ Server: findByToken → onGetUserDetails(userId) → MutableAuthState
       ├─ WeakMap.set(socket, state)
       ├─ setAuthState(state)           ← async context for actions
       ├─ emitUserAuthenticated({ userId, userDetails })
       │     └─ Client: stores user in AuthContext
       └─ config.onConnected({ user, deviceInfo })

Action handler (server)
  └─ useAuth() → { user, deviceInfo, refresh, signOut }

User signs out (client)
  └─ fires mxdbSignOutAction → server handler: signedOut=true, socket.disconnect()
        └─ onClientDisconnected → config.onDisconnected({ ..., reason: 'signedOut' })

Connection lost
  └─ onClientDisconnected → signedOut=false → config.onDisconnected({ ..., reason: 'connectionLost' })
```

---

## Files touched

| File | Change |
|---|---|
| `src/common/models/authModels.ts` | `MXDBUserDetails extends Record`, event payload type update |
| `src/common/internalActions.ts` | Add `mxdbSignOutAction` |
| `src/common/internalEvents.ts` | Add `userDetails` to `mxdbUserAuthenticated` payload |
| `src/server/internalModels.ts` | Add `onConnected`, `onDisconnected` to `ServerConfig` |
| `src/server/auth/useAuth.ts` | **New** — `MutableAuthState`, WeakMap, async context, `useAuth()` |
| `src/server/actions/signOutAction.ts` | **New** — `mxdbSignOutAction` handler |
| `src/server/actions/index.ts` | Register sign-out action in `internalActions` array |
| `src/server/startAuthenticatedServer.ts` | Populate auth state on connect; wire `onConnected`/`onDisconnected` |
| `src/server/index.ts` | Export `useAuth` |
| `src/client/auth/AuthContext.ts` | Add `user: MXDBUserDetails \| undefined` to `AuthContextValue` |
| `src/client/auth/AuthProvider.tsx` | Store user from event; fire `mxdbSignOutAction`; clear user on signOut |
| `src/client/hooks/useMXDBAuth.ts` → `useAuth.ts` | Rename file, function, type; add `user` |
| `src/client/hooks/index.ts` | Update re-export |
| `src/client/auth/hooks.tests.tsx` | Update all references |
