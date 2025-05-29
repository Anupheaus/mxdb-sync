import { useContext, useMemo, useRef, useState } from 'react';
import { SyncContextBusy } from './providers/sync/SyncContexts';
import { useSocketAPI } from '@anupheaus/socket-api/client';
import { PromiseState } from '@anupheaus/common';

export function useMXDBSync() {
  const { getIsConnected, onConnectionStateChanged, getSocket, testDisconnect, testReconnect } = useSocketAPI();
  const [isConnected, setIsConnected] = useState(useMemo(() => getIsConnected(), []));
  const { isValid, getSyncPromise, onSyncChanged } = useContext(SyncContextBusy);
  const updateWhenChangedRef = useRef(false);
  const [clientId, setClientId] = useState(() => getIsConnected() ? getSocket()?.id : undefined);
  const [isSyncing, setIsSyncing] = useState(() => isValid && getSyncPromise().state === PromiseState.Pending);
  const updateWhenSyncChangedRef = useRef(false);

  onConnectionStateChanged((newIsConnected, socket) => {
    if (!updateWhenChangedRef.current) return;
    setClientId(socket?.id);
    setIsConnected(newIsConnected);
  });

  onSyncChanged(newIsSyncing => {
    if (!updateWhenSyncChangedRef.current) return;
    setIsSyncing(newIsSyncing);
  });



  return {
    get isSynchronising() { updateWhenSyncChangedRef.current = true; return isSyncing; },
    get isConnected() { updateWhenChangedRef.current = true; return isConnected; },
    get clientId() { updateWhenChangedRef.current = true; return clientId; },
    onConnectionStateChanged,
    onSyncChanged,
    testDisconnect,
    testReconnect,
  };
}