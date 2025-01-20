import { useContext, useMemo, useRef, useState } from 'react';
import { useSocket } from './providers';
import { SyncContextBusy } from './providers/sync/SyncContexts';

export function useMXDBSync() {
  const { isConnected: getIsConnected, onConnectionStateChange, getSocket, } = useSocket();
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
  };
}