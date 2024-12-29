import type { MXDBSyncedCollection } from '../common';
import { useSync } from './providers';
import type { Record } from '@anupheaus/common';
import { is } from '@anupheaus/common';
import { useDataCollection, useSyncCollection } from './useInternalCollections';

export function createRemove<RecordType extends Record>(collection: MXDBSyncedCollection<RecordType>, dbName?: string) {
  const { remove: mxdbRemove, get: mxdbGet } = useDataCollection(collection, dbName);
  const { removeSyncRecords } = useSyncCollection(collection, dbName);
  const { finishSyncing } = useSync();

  async function remove(id: string): Promise<void>;
  async function remove(ids: string[]): Promise<void>;
  async function remove(record: RecordType): Promise<void>;
  async function remove(records: RecordType[]): Promise<void>;
  async function remove(recordsOrIds: RecordType | RecordType[] | string | string[]): Promise<void> {
    let records: RecordType[] = [];
    await finishSyncing();
    if (!is.array(recordsOrIds)) {
      if (is.string(recordsOrIds)) {
        records = await mxdbGet([recordsOrIds]);
      } else {
        records = [recordsOrIds];
      }
    } else {
      const recordIds = recordsOrIds.filter(is.string);
      records = recordsOrIds.filter(recordOrId => !is.string(recordOrId)) as RecordType[];
      if (recordIds.length > 0) records = records.concat(await mxdbGet(recordIds));
    }
    await mxdbRemove(records);
    await removeSyncRecords(records.ids());
  }

  return remove;
}