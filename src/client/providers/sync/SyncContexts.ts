import type { Record } from '@anupheaus/common';
import { createContext } from 'react';
import type { MXDBUpsert } from '../../internalModels';
import type { MXDBSyncClientRecord } from '../../../common/internalModels';

export interface SyncUtilsContextProps {
  addToSync(upsert: MXDBUpsert<MXDBSyncClientRecord>, type: 'upsert' | 'remove', records: Record[]): Promise<void>;
}

export const SyncUtilsContext = createContext<SyncUtilsContextProps>({
  addToSync: () => Promise.resolve(),
});

export interface SyncContextBusyProps {
  isSyncing: boolean;
  getIsSyncing(): boolean;
}

export const SyncContextBusy = createContext<SyncContextBusyProps>({
  isSyncing: false,
  getIsSyncing: () => false,
});
