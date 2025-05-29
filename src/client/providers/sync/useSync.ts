import { useContext } from 'react';
import { SyncContextBusy } from './SyncContexts';
import { PromiseState } from '@anupheaus/common';

export function useSync() {
  const { isValid, getSyncPromise } = useContext(SyncContextBusy);
  if (!isValid) throw new Error('useSync must be used within a SyncProvider');

  return {
    get isSyncing() { return getSyncPromise().state === PromiseState.Pending; },
    finishSyncing() { return getSyncPromise(); },
  };
}