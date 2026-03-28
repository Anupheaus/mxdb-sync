/**
 * §4.8 — Sign-out hook.
 *
 * Clears all auth state for the current device:
 *  1. Clears `isDefault` on all IndexedDB entries (via `AuthTokenContext.clearToken`).
 *  2. `IndexedDbBridge` reacts by nulling `connectionToken`, which removes the `auth`
 *     prop from `SocketAPI` and triggers a socket disconnect + unmounts `DbsProvider`
 *     (which closes the SQLite DB).
 *  3. The SQLite `mxdb_authentication` row is cleared automatically when `DbsProvider`
 *     unmounts via `SqliteTokenSync` no longer rendering, but callers can optionally
 *     call `db.clearAuth()` beforehand if they need an immediate guarantee.
 */

import { useContext, useCallback } from 'react';
import { AuthTokenContext } from '../auth/AuthTokenContext';

export interface UseMXDBSignOutResult {
  signOut(): Promise<void>;
}

export function useMXDBSignOut(): UseMXDBSignOutResult {
  const { clearToken } = useContext(AuthTokenContext);
  const signOut = useCallback(() => clearToken(), [clearToken]);
  return { signOut };
}
