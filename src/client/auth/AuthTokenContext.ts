import { createContext } from 'react';
import type { MXDBAuthEntry } from './IndexedDbAuthStore';

export interface AuthTokenContextValue {
  /** WebSocket host (passed through for useMXDBInvite's temporary connection). */
  host: string | undefined;
  /** App name / socket-api name (used to build the /{name}/register namespace URL). */
  name: string;
  /** True once a device entry has been loaded from IndexedDB and DbsProvider is active. */
  isAuthenticated: boolean;
  /** Updates the stored token in IndexedDB + SQLite and triggers a socket reconnect. */
  setToken(token: string): Promise<void>;
  /** Clears isDefault on all IndexedDB entries (sign-out). */
  clearToken(): Promise<void>;
  /**
   * Saves a newly registered device entry to IndexedDB and triggers the provider
   * tree to open the user's SQLite DB and connect the socket.
   *
   * @param encryptionKey - Pre-derived AES-GCM key bytes (from WebAuthn PRF).
   *   Pass the key here to avoid a second WebAuthn round-trip after registration.
   */
  saveEntry(entry: MXDBAuthEntry, encryptionKey?: Uint8Array): Promise<void>;
}

export const AuthTokenContext = createContext<AuthTokenContextValue>({
  host: undefined,
  name: '',
  isAuthenticated: false,
  setToken: async () => void 0,
  clearToken: async () => void 0,
  saveEntry: async (_entry, _key) => void 0,
});
