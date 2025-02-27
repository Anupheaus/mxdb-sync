import { createComponent } from '@anupheaus/react-ui';
import { mxdbSyncCollectionAction } from '../../../common';
import { useDataCollection, useSyncCollection } from '../../useInternalCollections';
import { useLogger } from '../../logger';
import { DateTime } from 'luxon';
import { useContext, useRef } from 'react';
import { useCurrentCollection } from '../collection';
import { SyncUtilsContext } from './SyncContexts';
import { useAction, useSocketAPI } from '@anupheaus/socket-api/client';

export const SyncCollection = createComponent('SyncCollection', () => {
  const { onConnected } = useSocketAPI();
  const { mxdbSyncCollectionAction: syncCollection } = useAction(mxdbSyncCollectionAction);
  const collection = useCurrentCollection();
  const { onSyncing } = useContext(SyncUtilsContext);
  const logger = useLogger(collection.name);
  const { clear: clearDataRecords, getCount } = useDataCollection(collection);
  const { isSyncingEnabled, getAllSyncRecords, markAsSynced, unmarkAsSynced } = useSyncCollection(collection);
  const syncRequestIdRef = useRef('');

  onConnected(async () => {
    if (!isSyncingEnabled) return;
    const syncRequestId = syncRequestIdRef.current = Math.uniqueId();

    onSyncing(collection, true);
    logger.info('Synchronising records...');
    const timeStarted = DateTime.now();
    let syncCancelled = false;
    const interval = setInterval(async () => {
      if (syncRequestId !== syncRequestIdRef.current) {
        logger.debug('Current sync request has been cancelled because a newer request has occurred.');
        syncCancelled = true;
        clearInterval(interval);
        onSyncing(collection, false);
        return;
      }
      const timeTaken = DateTime.now().diff(timeStarted);
      if (timeTaken.as('seconds') >= 60) {
        logger.error('Sync took too long, cancelling...');
        syncCancelled = true;
        clearInterval(interval);
        onSyncing(collection, false);
        return;
      }
      logger.debug('Still synchronising records...', { timeTaken: timeTaken.toFormat('mm:ss') });
    }, 5000);
    try {
      const syncRecords = await getAllSyncRecords();
      const dataCount = await getCount();

      if (isSyncingEnabled && syncRecords.length === 0 && dataCount > 0) {
        await clearDataRecords();
        return;
      }
      const syncData = await markAsSynced(syncRecords);
      try {
        await syncCollection({ records: syncRecords, collectionName: collection.name });
      } catch (error) {
        await unmarkAsSynced(syncData);
        throw error;
      }
    } finally {
      if (!syncCancelled) {
        clearInterval(interval);
        logger.info('Finished synchronising records.');
        onSyncing(collection, false);
      }
    }
  });

  return null;
});
