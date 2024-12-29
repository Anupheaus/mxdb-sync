import { createContext } from 'react';
import type { MXDBSyncedCollection } from '../../../common';

export interface SyncUtilsContextProps {
  isValid: boolean;
  onSyncing(collection: MXDBSyncedCollection, isSyncing: boolean): void;
}

export const SyncUtilsContext = createContext<SyncUtilsContextProps>({
  isValid: false,
  onSyncing: () => void 0,
});

export interface SyncContextBusyProps {
  isSyncing: boolean;
  getIsSyncing(): boolean;
}

export const SyncContextBusy = createContext<SyncContextBusyProps>({
  isSyncing: false,
  getIsSyncing: () => false,
});
