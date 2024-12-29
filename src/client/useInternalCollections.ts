import { generateSyncTime, isNewer, type MXDBSyncedCollection } from '../common';
import { useCollection } from '@anupheaus/mxdb';
import type { Record } from '@anupheaus/common';
import { syncCollectionRegistry } from '../common/registries';
import type { MXDBSyncClientRecord } from '../common/internalModels';

export function useDataCollection<RecordType extends Record>(collection: MXDBSyncedCollection<RecordType>, dbName?: string) {
  return useCollection(collection, dbName);
}

export function useSyncCollection<RecordType extends Record>(collection: MXDBSyncedCollection<RecordType>, dbName?: string) {
  const syncCollection = syncCollectionRegistry.getForClient(collection);
  const result = syncCollection != null ? useCollection(syncCollection, dbName) : undefined;

  const upsert = async (records: RecordType[], syncTime: number = generateSyncTime()): Promise<{ updatableRecords: RecordType[]; notUpdatableRecords: RecordType[]; }> => {
    if (result == null) return { updatableRecords: records, notUpdatableRecords: [] };

    const existingSyncRecords = await result.get(records.ids());
    const cannotBeSyncedRecords: RecordType[] = [];
    const syncedRecords: RecordType[] = [];
    const syncRecords: MXDBSyncClientRecord<RecordType>[] = [];
    records.forEach(record => {
      const existingSyncRecord = existingSyncRecords.findById(record.id);
      if (isNewer(existingSyncRecord, syncTime)) {
        cannotBeSyncedRecords.push(record);
      } else {
        syncRecords.push(existingSyncRecord != null ? { ...existingSyncRecord, lastSyncTimestamp: syncTime } : { id: record.id, lastSyncTimestamp: syncTime, audit: {} });
        syncedRecords.push(record);
      }
    });
    await result.upsert(syncRecords);
    return { updatableRecords: syncedRecords, notUpdatableRecords: cannotBeSyncedRecords };
  };

  // const upsertFromQuery = async (records: RecordType[], requestTime: number = generateSyncTime()): Promise<RecordType[]> => {
  //   if (result == null) return records;
  //   const { updatableRecords } = await upsertFromServerSync(records, requestTime);
  //   // ignore the cannot be synced records because they have been edited and not yet sync'd.  The server will sync them and do the merging.
  //   return updatableRecords;
  // };

  const getAllSyncRecords = async (): Promise<MXDBSyncClientRecord<RecordType>[]> => {
    if (result == null) return [];
    const { records } = await result.query({ filters: {} });
    return records;
  };

  const removeSyncRecords = async (ids: string[]): Promise<void> => {
    if (result == null) return;
    return result.remove(ids);
  };

  const updateSavedFromServerSync = async (ids: string[], syncTime: number = generateSyncTime()): Promise<void> => {
    if (result == null) return;
    const existingSyncRecords = await result.get(ids);
    const syncRecords = existingSyncRecords.mapWithoutNull((existingSyncRecord): MXDBSyncClientRecord<RecordType> | undefined => {
      if (isNewer(existingSyncRecord, syncTime)) return;
      return { ...existingSyncRecord, lastSyncTimestamp: syncTime };
    });
    await result.upsert(syncRecords);
  };

  return {
    get isSyncingEnabled() {
      return result != null;
    },
    upsert,
    // upsertFromQuery,
    getAllSyncRecords,
    removeSyncRecords,
    updateSavedFromServerSync,
  };
}
