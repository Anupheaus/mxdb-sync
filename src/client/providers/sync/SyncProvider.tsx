import { createComponent, useMap, useSyncState } from '@anupheaus/react-ui';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import type { SyncUtilsContextProps, SyncContextBusyProps } from './SyncContexts';
import { SyncUtilsContext, SyncContextBusy } from './SyncContexts';
import type { MXDBSyncedCollection } from '../../../common';

interface Props {
  children?: ReactNode;
}

export const SyncProvider = createComponent('SyncProvider', ({
  children,
}: Props) => {
  const busyCollections = useMap();
  const { state: isBusy, getState: getIsBusy, setState: setIsBusy } = useSyncState(() => false);

  const utilsContext = useMemo<SyncUtilsContextProps>(() => ({
    isValid: true,
    onSyncing: (collection: MXDBSyncedCollection, isSyncing: boolean) => {
      busyCollections.set(collection.name, isSyncing);
      setIsBusy(Array.from(busyCollections.values()).some(v => v === true));
    },
  }), []);

  const isBusyContext = useMemo<SyncContextBusyProps>(() => ({
    isSyncing: isBusy,
    getIsSyncing: getIsBusy,
  }), [isBusy]);

  return (
    <SyncUtilsContext.Provider value={utilsContext}>
      <SyncContextBusy.Provider value={isBusyContext}>
        {children}
      </SyncContextBusy.Provider>
    </SyncUtilsContext.Provider>
  );
});
