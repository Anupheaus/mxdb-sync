import { useContext, useMemo, useRef, useState } from 'react';
import { SyncContextBusy } from './providers/sync/SyncContexts';
import { useSocketAPI } from '@anupheaus/socket-api/client';

export function useMXDBSync() {
  const { getIsConnected, onConnectionStateChange, getSocket, testDisconnect, testReconnect } = useSocketAPI();
  const [isConnected, setIsConnected] = useState(useMemo(() => getIsConnected(), []));
  const { isSyncing } = useContext(SyncContextBusy);
  const updateWhenChangedRef = useRef(false);
  const [clientId, setClientId] = useState(useMemo(() => getIsConnected() ? getSocket()?.id : undefined, []));

  onConnectionStateChange((newIsConnected, socket) => {
    if (!updateWhenChangedRef.current) return;
    setClientId(socket?.id);
    setIsConnected(newIsConnected);
  });

  return {
    isSynchronising: isSyncing,
    get isConnected() { updateWhenChangedRef.current = true; return isConnected; },
    get clientId() { updateWhenChangedRef.current = true; return clientId; },
    onConnectionStateChange,
    testDisconnect,
    testReconnect,
  };
}