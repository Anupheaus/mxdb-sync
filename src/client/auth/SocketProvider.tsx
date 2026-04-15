// src/client/auth/SocketProvider.tsx
/**
 * Wraps SocketAPI and handles token rotation internally.
 *
 * Token rotation flow:
 *  1. Server emits mxdbTokenRotated({ newToken })
 *  2. SocketInner receives it, calls onTokenRotated(newToken) → TokenProvider writes to SQLite
 *  3. SocketInner mutates socket.auth so the next reconnect uses the new token
 *  No React state update → no socket reconnect triggered.
 */
import { createComponent } from '@anupheaus/react-ui';
import type { ReactNode } from 'react';
import { SocketAPI, useEvent, useSocketAPI, useAction } from '@anupheaus/socket-api/client';
import { mxdbTokenRotated, mxdbUserAuthenticated } from '../../common';
import { mxdbSignOutAction } from '../../common/internalActions';
import { useContext, useEffect } from 'react';
import { UserIdContext } from './UserIdContext';
import { ClientToServerSyncProvider, ClientToServerProvider } from '../providers/client-to-server';
import { ServerToClientProvider } from '../providers/server-to-client';
import type { MXDBCollection, MXDBError } from '../../common';

interface Props {
  appName: string;
  host?: string;
  token: string;
  keyHash: string;
  collections: MXDBCollection[];
  onError?(error: MXDBError): void;
  onTokenRotated(newToken: string): Promise<void>;
  onRegisterSignOutAction(fn: (() => void) | undefined): void;
  children?: ReactNode;
}

// Inner component — must be a child of SocketAPI to use useEvent / useSocketAPI / useAction.
interface InnerProps {
  collections: MXDBCollection[];
  onError?(error: MXDBError): void;
  onTokenRotated(newToken: string): Promise<void>;
  onRegisterSignOutAction(fn: (() => void) | undefined): void;
  children?: ReactNode;
}

const SocketInner = createComponent('SocketInner', ({
  collections,
  onError,
  onTokenRotated,
  onRegisterSignOutAction,
  children,
}: InnerProps) => {
  const { getRawSocket } = useSocketAPI();
  const { setUser } = useContext(UserIdContext);
  const onTokenRotatedEvent = useEvent(mxdbTokenRotated);
  const onUserAuthenticatedEvent = useEvent(mxdbUserAuthenticated);
  const { mxdbSignOutAction: fireSignOut } = useAction(mxdbSignOutAction);

  // Register the fire function so AuthProvider can call it from signOut()
  useEffect(() => {
    onRegisterSignOutAction(() => fireSignOut());
    return () => onRegisterSignOutAction(undefined);
  }, [fireSignOut, onRegisterSignOutAction]);

  onUserAuthenticatedEvent(userDetails => setUser(userDetails));

  onTokenRotatedEvent(async ({ newToken }) => {
    await onTokenRotated(newToken);
    // Mutate socket.auth so the next reconnect authenticates with the new token.
    const socket = getRawSocket();
    if (socket != null) {
      socket.auth = { ...(socket.auth as Record<string, string>), token: newToken };
    }
  });

  return (
    <ClientToServerSyncProvider collections={collections} onError={onError}>
      <ClientToServerProvider />
      <ServerToClientProvider />
      {children}
    </ClientToServerSyncProvider>
  );
});

export const SocketProvider = createComponent('SocketProvider', ({
  appName,
  host,
  token,
  keyHash,
  collections,
  onError,
  onTokenRotated,
  onRegisterSignOutAction,
  children,
}: Props) => (
  <SocketAPI name={appName} host={host} auth={{ token, keyHash }}>
    <SocketInner
      collections={collections}
      onError={onError}
      onTokenRotated={onTokenRotated}
      onRegisterSignOutAction={onRegisterSignOutAction}
    >
      {children}
    </SocketInner>
  </SocketAPI>
));
