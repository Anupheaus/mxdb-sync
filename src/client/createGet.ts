import type { Record } from '@anupheaus/common';
import type { MXDBSyncedCollection } from '../common';
import { useSocket, useSync } from './providers';
import { useDataCollection, useSyncCollection } from './useInternalCollections';
import { SyncEvents } from '../common/syncEvents';

export function createGet<RecordType extends Record>(collection: MXDBSyncedCollection<RecordType>, dbName?: string) {
  const { isConnected, emit } = useSocket();
  const { get, upsert } = useDataCollection(collection, dbName);
  const { upsert: upsertSyncRecords } = useSyncCollection(collection, dbName);
  const { finishSyncing } = useSync();

  return async (id: string) => {
    await finishSyncing();
    let record = await get(id);
    if (record == null) {
      if (isConnected()) {
        record = await SyncEvents.collection(collection).get.emit(emit, id);
        if (record != null) {
          upsert(record);
          upsertSyncRecords([record]);
        }
      }
    }
    return record;
  };
}

export type Get<RecordType extends Record> = ReturnType<typeof createGet<RecordType>>;
