import { createComponent } from '@anupheaus/react-ui';
import { generateSyncTime, mxdbServerPush } from '../../../common';
import { useEvent } from '../../hooks';
import { useLogger } from '../../logger';
import { useCurrentCollection } from '../collection';
import { useDataCollection, useSyncCollection } from '../../useInternalCollections';

export const PushCollection = createComponent('PushCollection', () => {
  const onServerPush = useEvent(mxdbServerPush);
  const collection = useCurrentCollection();
  const { remove: removeDataRecords, upsert: upsertDataRecords } = useDataCollection(collection);
  const { removeSyncRecords, updateUpdatedFromServerSync } = useSyncCollection(collection);
  const logger = useLogger();

  onServerPush(async ({ collectionName, updatedRecords, removedRecordIds }) => {
    if (collectionName !== collection.name) return;
    logger.debug('Server update received', { collectionName, updatedRecords: updatedRecords.length, removedRecordIds: removedRecordIds.length });
    const syncTime = generateSyncTime();
    if (updatedRecords.length > 0) {
      await upsertDataRecords(updatedRecords);
      await updateUpdatedFromServerSync(updatedRecords, syncTime);
    }
    if (removedRecordIds.length > 0) {
      await removeDataRecords(removedRecordIds);
      await removeSyncRecords(removedRecordIds);
    }
  });

  return null;
});
