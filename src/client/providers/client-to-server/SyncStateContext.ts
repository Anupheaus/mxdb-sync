import { createContext, useContext } from 'react';

export interface SyncStateContextValue {
  isSyncing: boolean;
  onSyncStateChanged(listener: (isSyncing: boolean) => void): () => void;
}

const noopUnsub = () => { /* noop */ };

export const SyncStateContext = createContext<SyncStateContextValue>({
  isSyncing: false,
  onSyncStateChanged: () => noopUnsub,
});

export function useSyncState(): SyncStateContextValue {
  return useContext(SyncStateContext);
}
