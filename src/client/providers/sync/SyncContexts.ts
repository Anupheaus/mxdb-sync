import { createContext } from 'react';
import { DeferredPromise } from '@anupheaus/common';

// export interface SyncUtilsContextProps {
//   isValid: boolean;
//   setSyncing(collection: MXDBCollection, isSyncing: boolean): void;
// }

// export const SyncUtilsContext = createContext<SyncUtilsContextProps>({
//   isValid: false,
//   setSyncing: () => void 0,
// });

export interface SyncContextBusyProps {
  isValid: boolean;
  getSyncPromise(): DeferredPromise<void>;
  onSyncChanged(callback: (isSyncing: boolean) => void): void;
}

export const SyncContextBusy = createContext<SyncContextBusyProps>({
  isValid: false,
  getSyncPromise: () => {
    const deferred = DeferredPromise.createDeferred<void>();
    deferred.resolve();
    return deferred;
  },
  onSyncChanged: () => void 0,
});
