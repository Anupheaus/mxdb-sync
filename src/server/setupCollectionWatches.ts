import type { MXDBSyncedCollection } from '../common';
import { mxdbServerPush } from '../common';
import { useCollections } from './collections';
import { useEvent } from './events';
import { useDb } from './providers';

export function setupCollectionWatches() {
  const serverPush = useEvent(mxdbServerPush);
  const { onWatch } = useDb();
  const { collections } = useCollections();
  const getWatchId = (collection: MXDBSyncedCollection) => `collection-watches-${collection.name}`;

  collections.forEach(collection => onWatch(getWatchId(collection), collection, update => {
    const updatedRecords = update.type === 'upsert' ? update.records : [];
    const removedRecordIds = update.type === 'remove' ? update.records : [];
    serverPush({ collectionName: collection.name, updatedRecords, removedRecordIds });
  }));
}