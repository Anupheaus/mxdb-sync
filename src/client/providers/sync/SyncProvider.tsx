import { createComponent, useBound, useMap, useSyncState } from '@anupheaus/react-ui';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import type { SyncUtilsContextProps, SyncContextBusyProps } from './SyncContexts';
import { SyncUtilsContext, SyncContextBusy } from './SyncContexts';
import { SyncCollection } from './SyncCollection';
import { generateSyncTime, type MXDBSyncedCollection } from '../../../common';
import type { MXDBSyncClientRecord } from '../../../common/internalModels';

interface Props {
  collections: MXDBSyncedCollection[];
  children?: ReactNode;
}

export const SyncProvider = createComponent('SyncProvider', ({
  collections,
  children,
}: Props) => {
  const busyCollections = useMap();
  const { state: isBusy, getState: getIsBusy, setState: setIsBusy } = useSyncState(() => false);

  const handleOnSyncUpdate = useBound((collection: MXDBSyncedCollection, isSyncing: boolean) => {
    busyCollections.set(collection.name, isSyncing);
    setIsBusy(Array.from(busyCollections.values()).some(v => v === true));
  });

  const collectionSynchronisers = useMemo(() => collections.map(collection => (
    <SyncCollection key={collection.name} collection={collection} onSyncUpdate={handleOnSyncUpdate} />
  )), [collections]);

  const utilsContext = useMemo<SyncUtilsContextProps>(() => ({
    addToSync: async (upsert, type, records) => {
      const timestamp = generateSyncTime();
      const userId = 'TODO';
      await upsert(records.map((record): MXDBSyncClientRecord => ({ id: record.id, lastSyncTimestamp: timestamp, audit: [{ timestamp, record, type, userId }] }) as any));
    },
  }), []);

  const isBusyContext = useMemo<SyncContextBusyProps>(() => ({
    isSyncing: isBusy,
    getIsSyncing: getIsBusy,
  }), [isBusy]);

  return (
    <SyncUtilsContext.Provider value={utilsContext}>
      <SyncContextBusy.Provider value={isBusyContext}>
        {collectionSynchronisers}
        {children}
      </SyncContextBusy.Provider>
    </SyncUtilsContext.Provider>
  );
});
