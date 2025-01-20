import { mxdbRemoveAction, type MXDBSyncedCollection } from '../common';
import { useSync } from './providers';
import type { Record } from '@anupheaus/common';
import { is } from '@anupheaus/common';
import { useDataCollection, useSyncCollection } from './useInternalCollections';
import { useAction } from './hooks';

export function createRemove<RecordType extends Record>(collection: MXDBSyncedCollection<RecordType>, dbName?: string) {
  const { remove: removeDataRecords } = useDataCollection(collection, dbName);
  const { markRecordsAsRemoved } = useSyncCollection(collection, dbName);
  const { isConnected, mxdbRemoveAction: sendRemoveRequest } = useAction(mxdbRemoveAction);
  const { finishSyncing } = useSync();

  async function remove(id: string): Promise<void>;
  async function remove(ids: string[]): Promise<void>;
  async function remove(record: RecordType): Promise<void>;
  async function remove(records: RecordType[]): Promise<void>;
  async function remove(recordsOrIds: RecordType | RecordType[] | string | string[]): Promise<void> {
    await finishSyncing();
    if (!is.array(recordsOrIds)) return is.string(recordsOrIds) ? remove([recordsOrIds]) : remove([recordsOrIds.id]);
    const recordIds = recordsOrIds.map(item => is.string(item) ? item : item.id);
    await removeDataRecords(recordIds);
    await markRecordsAsRemoved(recordIds);
    if (isConnected()) await sendRemoveRequest({ collectionName: collection.name, recordIds });
  }

  return remove;
}