/**
 * §4.3 / §4.4 — IndexedDB ↔ Provider bridge.
 *
 * Reads the default user entry from IndexedDB on mount, derives the AES-GCM
 * encryption key from the stored WebAuthn credential (via PRF), then:
 *  - Opens the user's encrypted SQLite DB (DbsProvider) with the random `dbName`
 *    and derived `encryptionKey`.
 *  - Connects the socket (SocketAPI) with the stored auth token and keyHash.
 *  - When no entry exists, still renders SocketAPI (without auth) so that
 *    `useMXDBInvite` can open its own temporary connection for registration.
 *
 * Key derivation: `loaded` stays `false` until both the IDB read and the
 * WebAuthn PRF assertion complete, so the UI never sees a partially-initialised
 * state. If PRF is unavailable the database opens without encryption.
 *
 * Token rotation: `connectionToken` is fixed for the lifetime of the session.
 * Only `saveEntry` (new registration) causes a fresh authenticated connection.
 */

import { createComponent, useLogger } from '@anupheaus/react-ui';
import type { ReactNode } from 'react';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { SocketAPI } from '@anupheaus/socket-api/client';
import { DbsProvider } from '../providers/dbs';
import type { MXDBCollection, MXDBError } from '../../common';
import type { AuthTokenContextValue } from './AuthTokenContext';
import { AuthTokenContext } from './AuthTokenContext';
import type { MXDBAuthEntry } from './IndexedDbAuthStore';
import { IndexedDbAuthStore, isIndexedDbAvailable } from './IndexedDbAuthStore';
import { SqliteTokenSync } from './SqliteTokenSync';
import { deriveEncryptionKey } from './deriveEncryptionKey';
import { ClientToServerSyncProvider, ClientToServerProvider } from '../providers/client-to-server';
import { ServerToClientProvider } from '../providers/server-to-client';

interface Props {
  host?: string;
  name: string;
  collections: MXDBCollection[];
  onError?(error: MXDBError): void;
  children?: ReactNode;
}

export const IndexedDbBridge = createComponent('IndexedDbBridge', ({ host, name, collections, onError, children }: Props) => {
  const dbsLogger = useLogger('Dbs');
  const [loaded, setLoaded] = useState(false);
  const [activeEntry, setActiveEntry] = useState<MXDBAuthEntry | undefined>(undefined);
  const [encryptionKey, setEncryptionKey] = useState<Uint8Array | undefined>(undefined);
  // connectionToken and connectionKeyHash are fixed for the lifetime of the session —
  // changing them would change the `auth` prop on SocketAPI and trigger a reconnect.
  const [connectionToken, setConnectionToken] = useState<string | undefined>(undefined);
  const [connectionKeyHash, setConnectionKeyHash] = useState<string | undefined>(undefined);

  // §4.8 — BroadcastChannel for cross-tab sign-out notification.
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    if (!isIndexedDbAvailable()) {
      setLoaded(true);
      return;
    }
    (async () => {
      const entry = await IndexedDbAuthStore.getDefault(name);
      setActiveEntry(entry);
      setConnectionToken(entry?.token);
      setConnectionKeyHash(entry?.keyHash);
      if (entry != null) {
        // Derive the encryption key before rendering DbsProvider so the DB
        // is opened with the correct key on the very first mount.
        const key = await deriveEncryptionKey(entry.credentialId);
        setEncryptionKey(key);
      }
      setLoaded(true);
    })();
  }, [name]);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(`mxdb-auth-${name}`);
    channelRef.current = channel;
    channel.onmessage = ({ data }: MessageEvent<{ type: string }>) => {
      if (data?.type === 'signed-out') {
        // Another tab signed out — clear local state without re-broadcasting.
        setActiveEntry(undefined);
        setEncryptionKey(undefined);
        setConnectionToken(undefined);
        setConnectionKeyHash(undefined);
      }
    };
    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [name]);

  // Updates IDB + SQLite (via SqliteTokenSync) but does NOT change connectionToken.
  const setToken = useCallback(async (token: string) => {
    await IndexedDbAuthStore.updateDefaultToken(name, token);
    setActiveEntry(prev => prev != null ? { ...prev, token } : prev);
  }, [name]);

  const clearToken = useCallback(async () => {
    await IndexedDbAuthStore.clearAllDefaults(name);
    channelRef.current?.postMessage({ type: 'signed-out' });
    setActiveEntry(undefined);
    setEncryptionKey(undefined);
    setConnectionToken(undefined);
    setConnectionKeyHash(undefined);
  }, [name]);

  // Called by useMXDBInvite after a successful registration.
  // Accepts the pre-derived key so no second WebAuthn round-trip is needed.
  const saveEntry = useCallback(async (entry: MXDBAuthEntry, key?: Uint8Array) => {
    await IndexedDbAuthStore.save(name, entry);
    setEncryptionKey(key);
    setActiveEntry(entry);
    setConnectionToken(entry.token);
    setConnectionKeyHash(entry.keyHash);
  }, [name]);

  const authContext = useMemo<AuthTokenContextValue>(
    () => ({ host, name, isAuthenticated: activeEntry != null, setToken, clearToken, saveEntry }),
    [host, name, activeEntry, setToken, clearToken, saveEntry],
  );

  if (!loaded) return null;

  return (
    <AuthTokenContext.Provider value={authContext}>
      {activeEntry != null && connectionToken != null ? (
        <SocketAPI host={host} name={name} auth={{ token: connectionToken, ...(connectionKeyHash != null && { keyHash: connectionKeyHash }) }}>
          <DbsProvider
            name={activeEntry.dbName}
            collections={collections}
            encryptionKey={encryptionKey}
            logger={dbsLogger}
          >
            <SqliteTokenSync token={activeEntry.token} keyHash={activeEntry.keyHash} />
            <ClientToServerSyncProvider collections={collections} onError={onError}>
              <ClientToServerProvider />
              <ServerToClientProvider />
              {children}
            </ClientToServerSyncProvider>
          </DbsProvider>
        </SocketAPI>
      ) : (
        children
      )}
    </AuthTokenContext.Provider>
  );
});
