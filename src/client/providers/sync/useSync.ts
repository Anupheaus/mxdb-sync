import { useContext, useLayoutEffect, useRef } from 'react';
import { SyncContextBusy } from './SyncContexts';
// import type { MXDBSyncedCollection } from '../../../common';
// import { useCollection } from '@anupheaus/mxdb';
import type { DeferredPromise } from '@anupheaus/common';
// import { syncCollectionRegistry } from '../../../common/registries';

export function useSync(/*collection: MXDBSyncedCollection<RecordType>, dbName?: string*/) {
  // const { addToSync: ctxAddToSync } = useContext(SyncUtilsContext);
  // const syncCollection = syncCollectionRegistry.getForClient(collection);
  // const { upsert = undefined } = syncCollection != null ? useCollection(syncCollection, dbName) : {};

  // const addToSync = useBound((type: 'upsert' | 'remove', records: RecordType[]) => upsert != null ? ctxAddToSync(upsert, type, records) : void 0);

  return {
    get isSyncing() { return useContext(SyncContextBusy).getIsSyncing(); },
    get finishSyncing() {
      const { isSyncing, getIsSyncing } = useContext(SyncContextBusy);
      const currentSyncPromiseRef = useRef<DeferredPromise<void>>();

      const checkSyncPromise = () => {
        const localIsSyncing = getIsSyncing();
        if (!localIsSyncing && currentSyncPromiseRef.current != null) currentSyncPromiseRef.current.resolve();
        if (localIsSyncing && currentSyncPromiseRef.current == null) currentSyncPromiseRef.current = Promise.createDeferred();
      };

      useLayoutEffect(() => {
        checkSyncPromise();
      }, [isSyncing]);

      return () => {
        checkSyncPromise();
        return currentSyncPromiseRef.current;
      };
    },
    // addToSync,
  };
}