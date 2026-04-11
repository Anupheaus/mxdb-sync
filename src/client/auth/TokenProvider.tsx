// src/client/auth/TokenProvider.tsx
/**
 * Reads the auth token from SQLite (db.readAuth) on mount.
 * Writes initialAuth to SQLite if the table is empty (first registration).
 * Passes a fixed connectionToken to SocketProvider — token is never changed
 * mid-session to avoid unnecessary socket reconnects.
 * onTokenRotated callback writes the new token to SQLite for the next session.
 */
import { createComponent } from '@anupheaus/react-ui';
import type { ReactNode } from 'react';
import { useState, useEffect, useCallback } from 'react';
import { useDb } from '../providers/dbs';
import { SocketProvider } from './SocketProvider';
import type { MXDBCollection, MXDBError } from '../../common';

interface Props {
  appName: string;
  host?: string;
  collections: MXDBCollection[];
  onError?(error: MXDBError): void;
  /** Provided by AuthProvider immediately after registration when SQLite is still empty. */
  initialAuth?: { token: string; keyHash: string };
  children?: ReactNode;
}

export const TokenProvider = createComponent('TokenProvider', ({
  appName,
  host,
  collections,
  onError,
  initialAuth,
  children,
}: Props) => {
  const { db } = useDb();
  // connectionToken is fixed for this session — changing it would reconnect the socket.
  const [connectionToken, setConnectionToken] = useState<string | undefined>();
  const [keyHash, setKeyHash] = useState<string | undefined>();

  useEffect(() => {
    (async () => {
      let auth = await db.readAuth();
      if (auth == null && initialAuth != null) {
        await db.writeAuth(initialAuth.token, initialAuth.keyHash);
        auth = initialAuth;
      }
      setConnectionToken(auth?.token);
      setKeyHash(auth?.keyHash);
    })();
  }, [db]);

  // Called by SocketProvider after the server rotates the token.
  // Writes to SQLite only — does NOT update connectionToken so no reconnect occurs.
  // SocketProvider updates socket.auth directly for reconnect scenarios.
  const onTokenRotated = useCallback(async (newToken: string) => {
    if (keyHash == null) return;
    await db.writeAuth(newToken, keyHash);
  }, [db, keyHash]);

  if (connectionToken == null || keyHash == null) return null;

  return (
    <SocketProvider
      appName={appName}
      host={host}
      token={connectionToken}
      keyHash={keyHash}
      collections={collections}
      onError={onError}
      onTokenRotated={onTokenRotated}
    >
      {children}
    </SocketProvider>
  );
});
