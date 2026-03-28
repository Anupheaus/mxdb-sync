import { createComponent, LoggerProvider } from '@anupheaus/react-ui';
import type { ReactNode } from 'react';
import { ConflictResolutionContext } from './providers';
import type { MXDBCollection, MXDBError, UnauthorisedOperationDetails } from '../common';
import type { Logger } from '@anupheaus/common';
import { useEffect, useMemo } from 'react';
import { IndexedDbBridge } from './auth/IndexedDbBridge';
import { TokenRotationProvider } from './auth/TokenRotationProvider';
import { setupBrowserTools } from './utils/setupBrowserTools';

interface Props {
  host?: string;
  name: string;
  logger?: Logger;
  collections: MXDBCollection[];
  onInvalidToken?(): Promise<void>;
  onUnauthorisedOperation?(): Promise<UnauthorisedOperationDetails>;
  onError?(error: MXDBError): void;
  /** §6.4 — Called when a root-record deletion conflict is detected. Return true to keep the local record, false to accept the deletion. */
  onConflictResolution?(message: string): Promise<boolean>;
  children?: ReactNode;
}

export const MXDBSync = createComponent('MXDBSync', ({
  host,
  name,
  logger,
  collections,
  onError,
  onConflictResolution,
  children,
}: Props) => {
  // Reject plain WebSocket (ws://) connections
  if (host != null) {
    const protocol = host.match(/^([a-z][a-z0-9+\-.]*:\/\/)/i)?.[1]?.toLowerCase();
    if (protocol != null && protocol !== 'wss://') {
      throw new Error(`MXDBSync: connection to "${host}" uses an insecure protocol. Only wss:// is allowed (§4.7).`);
    }
  }

  useEffect(() => {
    setupBrowserTools();
  }, []);

  const conflictResolutionContext = useMemo(() => ({ onConflictResolution }), [onConflictResolution]);

  return (
    <LoggerProvider logger={logger} loggerName="MXDB-Sync">
      <ConflictResolutionContext.Provider value={conflictResolutionContext}>
        {/*
         * §4.3 / §4.4: IndexedDbBridge reads the default user entry from IndexedDB,
         * opens DbsProvider with the user's random SQLite dbName, and connects
         * SocketAPI with the stored auth token. DbsProvider and SocketAPI are
         * rendered inside IndexedDbBridge so the dbName is known before they open.
         */}
        <IndexedDbBridge host={host} name={name} collections={collections} onError={onError}>
          <TokenRotationProvider />
          {children}
        </IndexedDbBridge>
      </ConflictResolutionContext.Provider>
    </LoggerProvider>
  );
});
