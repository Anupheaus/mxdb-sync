import { createComponent } from '@anupheaus/react-ui';
import { useSocket } from '../socket';
import { generateSyncTime } from '../../../common';
import { SyncEvents } from '../../../common/syncEvents';
import { useDataCollection, useSyncCollection } from '../../useInternalCollections';
import { useLogger } from '../../logger';
import { DateTime } from 'luxon';
import { useContext, useRef } from 'react';
import { useCurrentCollection } from '../collection';
import { SyncUtilsContext } from './SyncContexts';

export const SyncCollection = createComponent('SyncCollection', () => {
  const { onConnected } = useSocket();
  const collection = useCurrentCollection();
  const { onSyncing } = useContext(SyncUtilsContext);
  const logger = useLogger(collection.name);
  const { upsert: upsertDataRecords, remove: removeDataRecords, clear: clearDataRecords, getCount } = useDataCollection(collection);
  const { isSyncingEnabled, getAllSyncRecords, upsert: upsertSyncRecords, removeSyncRecords, updateSavedFromServerSync } = useSyncCollection(collection);
  const syncRequestIdRef = useRef('');

  onConnected(async socket => {
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

      const syncTime = generateSyncTime();
      const { updated, savedIds, removedIds } = await SyncEvents.collection(collection).sync.emit(socket.emitWithAck.bind(socket), { records: syncRecords });
      if (syncCancelled) return;

      if (removedIds.length > 0) {
        await removeDataRecords(removedIds);
        await removeSyncRecords(removedIds);
        if (syncCancelled) return;
      }
      if (updated.length > 0) {
        await upsertDataRecords(updated);
        await upsertSyncRecords(updated, syncTime);
        if (syncCancelled) return;
      }
      if (savedIds.length > 0) {
        await updateSavedFromServerSync(savedIds, syncTime);
        if (syncCancelled) return;
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
