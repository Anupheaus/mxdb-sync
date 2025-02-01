import { createComponent } from '@anupheaus/react-ui';
import { mxdbServerPush } from '../../../common';
import { useLogger } from '../../logger';
import { useCurrentCollection } from '../collection';
import { useDataCollection, useSyncCollection } from '../../useInternalCollections';
import { useEvent } from '@anupheaus/socket-api/client';

export const PushCollection = createComponent('PushCollection', () => {
  const onServerPush = useEvent(mxdbServerPush);
  const collection = useCurrentCollection();
  const { remove: removeDataRecords, upsert: upsertDataRecords } = useDataCollection(collection);
  const { removeSyncRecords, upsertFromPush } = useSyncCollection(collection);
  const logger = useLogger();

  onServerPush(async ({ collectionName, updatedRecords, removedRecordIds }) => {
    if (collectionName !== collection.name) return;
    logger.debug('Server update received', { collectionName, updatedRecords: updatedRecords.length, removedRecordIds: removedRecordIds.length });
    if (updatedRecords.length > 0) {
      const recordsAllowedToBeUpdated = await upsertFromPush(updatedRecords);
      await upsertDataRecords(recordsAllowedToBeUpdated);
    }
    if (removedRecordIds.length > 0) {
      await removeDataRecords(removedRecordIds);
      await removeSyncRecords(removedRecordIds);
    }
  });

  return null;
});
