import { createComponent } from '@anupheaus/react-ui';
import { useSocket } from '../socket';
import type { Record } from '@anupheaus/common';
import { generateSyncTime, type MXDBSyncedCollection } from '../../../common';
import { SyncEvents } from '../../../common/syncEvents';
import { useDataCollection, useSyncCollection } from '../../useInternalCollections';
import { useLogger } from '../../logger';
import { DateTime } from 'luxon';
import { useRef } from 'react';

interface Props {
  collection: MXDBSyncedCollection<Record>;
  onSyncUpdate(collection: MXDBSyncedCollection, isSyncing: boolean): void;
}

export const SyncCollection = createComponent('SyncCollection', ({
  collection,
  onSyncUpdate,
}: Props) => {
  const { onConnected } = useSocket();
  const logger = useLogger(collection.name);
  const { upsert: upsertDataRecords, remove: removeDataRecords, clear: clearDataRecords, getCount } = useDataCollection(collection);
  const { isSyncingEnabled, getAllSyncRecords, upsertFromServerSync, removeSyncRecords, updateSavedFromServerSync } = useSyncCollection(collection);
  const syncRequestIdRef = useRef('');

  onConnected(async socket => {
    if (!isSyncingEnabled) return;
    const syncRequestId = syncRequestIdRef.current = Math.uniqueId();
    onSyncUpdate(collection, true);
    logger.info('Synchronising records...');
    const timeStarted = DateTime.now();
    let syncCancelled = false;
    const interval = setInterval(async () => {
      if (syncRequestId !== syncRequestIdRef.current) {
        logger.debug('Current sync request has been cancelled because a newer request has occurred.');
        syncCancelled = true;
        clearInterval(interval);
        onSyncUpdate(collection, false);
        return;
      }
      const timeTaken = DateTime.now().diff(timeStarted);
      if (timeTaken.as('seconds') >= 60) {
        logger.error('Sync took too long, cancelling...');
        syncCancelled = true;
        clearInterval(interval);
        onSyncUpdate(collection, false);
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
        await upsertFromServerSync(updated, syncTime);
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
        onSyncUpdate(collection, false);
      }
    }
  });

  return null;
});
