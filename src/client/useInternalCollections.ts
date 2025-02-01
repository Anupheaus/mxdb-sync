import { getNowTime, useSyncTools, type MXDBSyncedCollection } from '../common';
import { useCollection } from '@anupheaus/mxdb';
import { is, type Record } from '@anupheaus/common';
import { syncCollectionRegistry } from '../common/registries';
import type { MXDBSyncClientRecord } from '../common/internalModels';
import { useUser } from '@anupheaus/socket-api/client';

export function useDataCollection<RecordType extends Record>(collection: MXDBSyncedCollection<RecordType>, dbName?: string) {
  return useCollection(collection, dbName);
}

export function useSyncCollection<RecordType extends Record>(collection: MXDBSyncedCollection<RecordType>, dbName?: string) {
  const syncCollection = syncCollectionRegistry.getForClient(collection);
  const result = syncCollection != null ? useCollection(syncCollection, dbName) : undefined;
  const { createSyncRecordFromRecord, createRecordFromSyncRecord, isNewer } = useSyncTools();
  const { getUser } = useUser();

  async function upsert(records: RecordType[]): Promise<{ updatableRecords: RecordType[]; notUpdatableRecords: RecordType[]; }> {
    const userId = getUser()?.id;
    if (result == null || userId == null) return { updatableRecords: records, notUpdatableRecords: [] };

    const existingSyncRecords = await result.get(records.ids());
    const cannotBeSyncedRecords: RecordType[] = [];
    const syncedRecords: RecordType[] = [];
    const syncRecords: MXDBSyncClientRecord<RecordType>[] = [];
    records.forEach(record => {
      const existingSyncRecord = existingSyncRecords.findById(record.id);
      const syncRecord = createSyncRecordFromRecord(record, existingSyncRecord, userId);
      syncRecords.push(syncRecord);
      syncedRecords.push(record);
    });
    await result.upsert(syncRecords);
    return { updatableRecords: syncedRecords, notUpdatableRecords: cannotBeSyncedRecords };
  }

  async function getAllSyncRecords(): Promise<MXDBSyncClientRecord<RecordType>[]> {
    if (result == null) return [];
    const { records } = await result.query({ filters: {} });
    return records;
  }

  async function markRecordsAsRemoved(ids: string[], syncTime: number = getNowTime()): Promise<void> {
    const userId = getUser()?.id;
    if (result == null || userId == null) return;
    const syncRecords = await result.get(ids);
    syncRecords.forEach(syncRecord => {
      syncRecord.audit[syncTime] = { operations: [{ op: 'delete', path: ['id'] }], userId };
    });
    await result.upsert(syncRecords);
  }

  async function removeSyncRecords(ids: string[]): Promise<void> {
    if (result == null) return;
    return result.remove(ids);
  }

  async function upsertFromPush(records: RecordType[]): Promise<RecordType[]> {
    const userId = getUser()?.id;
    if (result == null || userId == null) return records;

    const existingSyncRecords = await result.get(records.ids());
    const syncRecords: MXDBSyncClientRecord<RecordType>[] = [];
    const syncedRecordIds: string[] = [];
    const syncTime = getNowTime(); //ensure all records are synced to the same time
    records.forEach(record => {
      const existingSyncRecord = existingSyncRecords.findById(record.id);
      if (existingSyncRecord != null && isNewer(existingSyncRecord)) {
        const currentRecord = createRecordFromSyncRecord(existingSyncRecord);
        if (currentRecord == null) return; // if the record is deleted locally, don't create a new sync record
        if (!is.deepEqual(currentRecord, record)) return; // if the record is not the same, don't create a new sync record because the local one is newer than the server one
      }
      // create a new sync record for the record
      const syncRecord = createSyncRecordFromRecord(record, undefined, userId, syncTime) as MXDBSyncClientRecord<RecordType>;
      syncRecords.push(syncRecord);
      syncedRecordIds.push(syncRecord.id);
    });
    await result.upsert(syncRecords);
    return records.filter(record => syncedRecordIds.includes(record.id));
  }

  async function markAsSynced(records: RecordType[]): Promise<Map<string, number>> {
    const userId = getUser()?.id;
    if (result == null || userId == null) return new Map();
    const syncRecords = await result.get(records.ids());
    const syncTime = getNowTime();
    const lastSyncTimestamps = new Map<string, number>();
    records.map(record => {
      const syncRecord = syncRecords.findById(record.id);
      if (syncRecord == null) return;
      lastSyncTimestamps.set(record.id, syncRecord.lastSyncTimestamp);
      syncRecord.lastSyncTimestamp = syncTime;
    });
    await result.upsert(syncRecords);
    return lastSyncTimestamps;
  }

  async function unmarkAsSynced(syncData: Map<string, number>): Promise<void> {
    if (result == null) return;
    const syncRecords = await result.get(Array.from(syncData.keys()));
    syncRecords.forEach(syncRecord => {
      syncRecord.lastSyncTimestamp = syncData.get(syncRecord.id)!;
    });
    await result.upsert(syncRecords);
  }

  return {
    get isSyncingEnabled() {
      return result != null;
    },
    upsert,
    getAllSyncRecords,
    removeSyncRecords,
    markRecordsAsRemoved,
    upsertFromPush,
    markAsSynced,
    unmarkAsSynced,
  };
}
