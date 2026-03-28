import { createComponent, useLogger, useOnUnmount } from '@anupheaus/react-ui';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAction, useSocketAPI } from '@anupheaus/socket-api/client';
import { mxdbClientToServerSyncAction } from '../../../common';
import type { MXDBCollection, MXDBError } from '../../../common';
import { ClientToServerSynchronisation } from './ClientToServerSynchronisation';
import { ClientToServerSyncInstanceContext } from './useClientToServerSyncInstance';
import { ClientToServerSyncContext } from '../server-to-client/useClientToServerSync';
import { SyncStateContext } from './SyncStateContext';
import { useDb } from '../dbs';
import { ACTION_TIMEOUT_MS, withTimeout } from '../../utils/actionTimeout';

const C2S_DEBOUNCE_MS = 200;

interface Props {
  collections: MXDBCollection[];
  onError?(error: MXDBError): void;
  children?: ReactNode;
}

/**
 * §4.1 — Constructs one ClientToServerSynchronisation per MXDBSync mount.
 * Provides it to ClientToServerProvider (for enqueue) and ServerToClientProvider (for S2C gate).
 */
export const ClientToServerSyncProvider = createComponent('ClientToServerSyncProvider', ({
  collections,
  onError,
  children,
}: Props) => {
  const { db } = useDb();
  const { onConnectionStateChanged, getIsConnected } = useSocketAPI();
  const { mxdbClientToServerSyncAction: sendBatch } = useAction(mxdbClientToServerSyncAction);
const logger = useLogger('C2S');
  const c2sRef = useRef<ClientToServerSynchronisation | null>(null);

  // Construct once
  const c2s = useMemo(() => {
    const instance = new ClientToServerSynchronisation({
      debounceMs: C2S_DEBOUNCE_MS,
      sendBatch: request => withTimeout(
        sendBatch(request),
        ACTION_TIMEOUT_MS,
        'mxdbClientToServerSyncAction',
      ),
      getDb: () => db,
      collections,
      logger,
      onError: error => onError?.({
        code: 'SYNC_FAILED',
        message: error instanceof Error ? error.message : String(error),
        severity: 'error',
        originalError: error,
      }),
    });
    c2sRef.current = instance;
    return instance;
  }, []);

  // §4.1 — Wire onConnectionChanged
  onConnectionStateChanged((isConnected: boolean) => {
    c2s.setConnected(isConnected);
  });

  // Set initial connection state; setConnected triggers fullFlush if already connected
  useEffect(() => {
    c2s.setConnected(getIsConnected());
  }, []);

  // §4.1 — Close on unmount
  useOnUnmount(() => {
    c2s.close();
    c2sRef.current = null;
  });

  // Track sync state for consumers (useMXDBSync)
  const [isSyncing, setIsSyncing] = useState(false);
  useEffect(() => c2s.onSyncStateChanged(setIsSyncing), [c2s]);

  // Provide to both the instance context (for enqueue) and the gate context (for S2C)
  const gateValue = useMemo(() => ({
    waitForS2CGate: () => c2s.waitForS2CGate(),
  }), [c2s]);

  const syncStateValue = useMemo(() => ({
    isSyncing,
    onSyncStateChanged: (listener: (s: boolean) => void) => c2s.onSyncStateChanged(listener),
  }), [c2s, isSyncing]);

  return (
    <ClientToServerSyncInstanceContext.Provider value={c2s}>
      <ClientToServerSyncContext.Provider value={gateValue}>
        <SyncStateContext.Provider value={syncStateValue}>
          {children}
        </SyncStateContext.Provider>
      </ClientToServerSyncContext.Provider>
    </ClientToServerSyncInstanceContext.Provider>
  );
});
