import { useContext, useMemo, useRef, useState } from 'react';
import { useSocket } from './providers';
import { SyncContextBusy } from './providers/sync/SyncContexts';

export function useMXDBSync() {
  const { isConnected: getIsConnected, onConnectionStateChange } = useSocket();
  const [isConnected, setIsConnected] = useState(useMemo(() => getIsConnected(), []));
  const { isSyncing } = useContext(SyncContextBusy);
  const updateWhenChangedRef = useRef(false);

  onConnectionStateChange(newIsConnected => {
    if (!updateWhenChangedRef.current) return;
    setIsConnected(newIsConnected);
  });

  return {
    isSynchronising: isSyncing,
    get isConnected() { updateWhenChangedRef.current = true; return isConnected; },
    onConnectionStateChange,
  };
}