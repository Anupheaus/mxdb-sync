import { createComponent, useCallbacks, useLogger } from '@anupheaus/react-ui';
import type { ReactNode } from 'react';
import { useMemo, useRef } from 'react';
import type { SyncContextBusyProps } from './SyncContexts';
import { SyncContextBusy } from './SyncContexts';
import { PromiseState, type DeferredPromise } from '@anupheaus/common';
import { useAction, useSocketAPI } from '@anupheaus/socket-api/client';
import { useDb } from '../dbs';
import { synchroniseCollections } from './synchronise-collections';
import { mxdbSyncCollectionsAction } from '../../../common';

interface Props {
  children?: ReactNode;
}

export const SyncProvider = createComponent('SyncProvider', ({
  children,
}: Props) => {
  const syncPromiseRef = useRef<DeferredPromise<void>>(Promise.createDeferred());
  const syncRequestIdRef = useRef<string>('');
  const { db, collections } = useDb();
  const { onConnected, getIsConnected } = useSocketAPI();
  const logger = useLogger('SyncProvider');
  const { register: onSyncChanged, invoke: invokeSyncChanged } = useCallbacks<(isSyncing: boolean) => void>();
  const { mxdbSyncCollectionsAction: syncCollections } = useAction(mxdbSyncCollectionsAction);

  useMemo(() => {
    if (!getIsConnected()) syncPromiseRef.current.resolve();
  }, []);

  onConnected(async () => {
    const syncRequestId = syncRequestIdRef.current = Math.uniqueId();

    logger.info(`[${syncRequestId}] Socket connected, synchronising collections...`);
    const startTime = Date.now();
    if (syncPromiseRef.current.state !== PromiseState.Pending) {
      syncPromiseRef.current = Promise.createDeferred();
      invokeSyncChanged(true);
    }

    if (syncRequestIdRef.current !== syncRequestId) return;
    await synchroniseCollections(db, collections, syncCollections);

    if (syncRequestIdRef.current !== syncRequestId) return;
    logger.info(`[${syncRequestId}] Synchronisation complete.`, { timeTaken: Date.now() - startTime });
    syncPromiseRef.current.resolve();
    invokeSyncChanged(false);
  });

  const isBusyContext = useMemo<SyncContextBusyProps>(() => ({
    isValid: true,
    getSyncPromise: () => syncPromiseRef.current,
    onSyncChanged,
  }), []);

  return (
    <SyncContextBusy.Provider value={isBusyContext}>
      {children}
    </SyncContextBusy.Provider>
  );
});
