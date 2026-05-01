import { useMemo, useRef, useState } from 'react';
import { useSocketAPI } from '@anupheaus/socket-api/client';
import { useSyncState } from './providers/client-to-server/SyncStateContext';

export function useMXDBSync() {
  const { getIsConnected, onConnectionStateChanged, getSocket, disconnect, connect } = useSocketAPI();
  const [isConnected, setIsConnected] = useState(useMemo(() => getIsConnected(), []));
  const { isSyncing, onSyncStateChanged } = useSyncState();
  const updateWhenChangedRef = useRef(false);
  const [clientId, setClientId] = useState(() => getIsConnected() ? getSocket()?.id : undefined);
  const updateWhenSyncChangedRef = useRef(false);
  const [isSyncingState, setIsSyncingState] = useState(isSyncing);

  onConnectionStateChanged((newIsConnected, socket) => {
    if (!updateWhenChangedRef.current) return;
    setClientId(socket?.id);
    setIsConnected(newIsConnected);
  });

  return {
    get isSynchronising() {
      if (!updateWhenSyncChangedRef.current) {
        updateWhenSyncChangedRef.current = true;
        onSyncStateChanged(setIsSyncingState);
      }
      return isSyncingState;
    },
    get isConnected() { updateWhenChangedRef.current = true; return isConnected; },
    get clientId() { updateWhenChangedRef.current = true; return clientId; },
    onConnectionStateChanged,
    disconnect,
    connect,
  };
}
