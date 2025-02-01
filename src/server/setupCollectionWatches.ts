import { useEvent, useLogger } from '@anupheaus/socket-api/server';
import { mxdbServerPush } from '../common';
import { useCollections } from './collections';
import { useDb } from './providers';

export function setupCollectionWatches() {
  const serverPush = useEvent(mxdbServerPush);
  const logger = useLogger();
  const { onWatch } = useDb();
  const collections = useCollections();

  collections.forEach(collection => onWatch('collection-watch', collection, update => {
    const updatedRecords = update.type === 'upsert' ? update.records : [];
    const removedRecordIds = update.type === 'remove' ? update.records : [];
    logger.debug('Database update received, pushing to client', { collectionName: collection.name, updatedRecords, removedRecordIds });
    serverPush({ collectionName: collection.name, updatedRecords, removedRecordIds });
  }));
}