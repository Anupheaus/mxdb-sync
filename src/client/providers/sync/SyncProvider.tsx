import { createComponent, useCallbacks, useLogger } from '@anupheaus/react-ui';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import type { SyncContextBusyProps } from './SyncContexts';
import { SyncContextBusy } from './SyncContexts';
import { PromiseState, type DeferredPromise } from '@anupheaus/common';
import { useAction, useSocketAPI } from '@anupheaus/socket-api/client';
import { useDb } from '../dbs';
import { synchroniseCollections } from './synchronise-collections';
import { mxdbSyncCollectionsAction } from '../../../common';

const SYNC_TIMEOUT_MS = 30_000;
const SYNC_POLL_MS = 2_000;

interface Props {
  children?: ReactNode;
}

export const SyncProvider = createComponent('SyncProvider', ({
  children,
}: Props) => {
  const syncPromiseRef = useRef<DeferredPromise<void>>(Promise.createDeferred());
  const syncRequestIdRef = useRef<string>('');
  const { db, collections } = useDb();
  const { onConnected, getIsConnected, getSocket } = useSocketAPI();
  const logger = useLogger('SyncProvider');
  const { register: onSyncChanged, invoke: invokeSyncChanged } = useCallbacks<(isSyncing: boolean) => void>();
  const { mxdbSyncCollectionsAction: syncCollections } = useAction(mxdbSyncCollectionsAction);

  useMemo(() => {
    if (!getIsConnected()) syncPromiseRef.current.resolve();
  }, []);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onDisconnect = () => {
      if (syncPromiseRef.current.state === PromiseState.Pending) {
        logger.warn('Socket disconnected while sync was pending; releasing waiters.');
        syncPromiseRef.current.resolve();
        invokeSyncChanged(false);
      }
    };
    socket.on('disconnect', onDisconnect);
    return () => socket.off('disconnect', onDisconnect);
  }, [getSocket, logger, invokeSyncChanged]);

  const runSync = async (reason: 'connected' | 'poll') => {
    const syncRequestId = syncRequestIdRef.current = Math.uniqueId();

    logger.info(`[${syncRequestId}] Synchronising collections...`, { reason });
    const startTime = Date.now();
    if (syncPromiseRef.current.state !== PromiseState.Pending) {
      syncPromiseRef.current = Promise.createDeferred();
      invokeSyncChanged(true);
    }

    const releaseSync = () => {
      if (syncPromiseRef.current.state === PromiseState.Pending) {
        syncPromiseRef.current.resolve();
        invokeSyncChanged(false);
      }
    };

    try {
      const syncPromise = synchroniseCollections(db, collections, syncCollections);
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`Sync timed out after ${SYNC_TIMEOUT_MS}ms`)), SYNC_TIMEOUT_MS);
      });
      if (syncRequestIdRef.current !== syncRequestId) return;
      await Promise.race([syncPromise, timeoutPromise]).finally(() => {
        if (timeoutId != null) clearTimeout(timeoutId);
      });
    } catch (err) {
      logger.warn(`[${syncRequestId}] Sync failed or timed out`, { reason, error: (err as Error)?.message ?? String(err) });
      releaseSync();
      return;
    }

    if (syncRequestIdRef.current !== syncRequestId) return;
    logger.info(`[${syncRequestId}] Synchronisation complete.`, { reason, timeTaken: Date.now() - startTime });
    syncPromiseRef.current.resolve();
    invokeSyncChanged(false);
  };

  onConnected(() => runSync('connected'));

  // While connected, periodically sync audits so offline flushes and missed action acks still converge.
  useEffect(() => {
    if (!getIsConnected()) return;
    const id = setInterval(() => {
      if (!getIsConnected()) return;
      if (syncPromiseRef.current.state === PromiseState.Pending) return;
      void runSync('poll');
    }, SYNC_POLL_MS);
    return () => clearInterval(id);
  }, [getIsConnected]);

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
