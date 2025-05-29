import { getNowTime, useSyncTools, type MXDBCollection } from '../common';
import { useCollection } from '@anupheaus/mxdb';
import { InternalError, is, type Record } from '@anupheaus/common';
import { syncCollectionRegistry } from '../common/registries';
import type { MXDBSyncClientRecord } from '../common/internalModels';
import { useUser } from '@anupheaus/socket-api/client';

export function useDataCollection<RecordType extends Record>(collection: MXDBCollection<RecordType>, dbName?: string) {
  return useCollection(collection, dbName);
}

export function useSyncCollection<RecordType extends Record>(collection: MXDBCollection<RecordType>, dbName?: string) {
  const syncCollection = syncCollectionRegistry.getForClient(collection);
  const result = syncCollection != null ? useCollection(syncCollection, dbName) : undefined;
  const { createSyncRecordFromRecord, createRecordFromSyncRecord, isNewer } = useSyncTools();
  const { getUser } = useUser();

  async function upsert(records: RecordType[]): Promise<{ updatableRecords: RecordType[]; notUpdatableRecords: RecordType[]; }> {
    const userId = getUser()?.id;
    if (userId == null) throw new InternalError('Records could not be synchronised as there is no current user.');
    if (result == null) return { updatableRecords: records, notUpdatableRecords: [] };

    const existingSyncRecords = await result.get(records.ids());
    const cannotBeSyncedRecords: RecordType[] = [];
    const syncedRecords: RecordType[] = [];
    const syncRecords: MXDBSyncClientRecord<RecordType>[] = [];
    await records.forEachPromise(async record => {
      const existingSyncRecord = existingSyncRecords.findById(record.id);
      const syncRecord = await createSyncRecordFromRecord(record, existingSyncRecord, userId);
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
    if (userId == null) throw new InternalError('Records could not be synchronised as there is no current user.');
    if (result == null) return;
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
    if (userId == null) throw new InternalError('Records could not be synchronised as there is no current user.');
    if (result == null) return records;

    const existingSyncRecords = await result.get(records.ids());
    const syncRecords: MXDBSyncClientRecord<RecordType>[] = [];
    const syncedRecordIds: string[] = [];
    const syncTime = getNowTime(); //ensure all records are synced to the same time
    await records.forEachPromise(async record => {
      const existingSyncRecord = existingSyncRecords.findById(record.id);
      if (existingSyncRecord != null && isNewer(existingSyncRecord)) {
        const currentRecord = await createRecordFromSyncRecord(existingSyncRecord, () => result.upsert(existingSyncRecord));
        if (currentRecord == null) return; // if the record is deleted locally, don't create a new sync record
        if (!is.deepEqual(currentRecord, record)) return; // if the record is not the same, don't create a new sync record because the local one is newer than the server one
      }
      // create a new sync record for the record
      const syncRecord = await createSyncRecordFromRecord(record, undefined, userId, syncTime) as MXDBSyncClientRecord<RecordType>;
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

  async function get(id: string): Promise<MXDBSyncClientRecord<RecordType> | undefined>;
  async function get(ids: string[]): Promise<MXDBSyncClientRecord<RecordType>[]>;
  async function get(record: RecordType): Promise<MXDBSyncClientRecord<RecordType> | undefined>;
  async function get(records: RecordType[]): Promise<MXDBSyncClientRecord<RecordType>[]>;
  async function get(records: string | RecordType): Promise<MXDBSyncClientRecord<RecordType>[]>;
  async function get(records: string[] | RecordType[]): Promise<MXDBSyncClientRecord<RecordType>[]>;
  async function get(args: string | RecordType | string[] | RecordType[]): Promise<MXDBSyncClientRecord<RecordType> | MXDBSyncClientRecord<RecordType>[] | undefined> {
    if (result == null) return undefined;
    const isSingular = !is.array(args);
    if (!is.array(args)) return get([args as any]);
    const ids = args.mapWithoutNull(recordOrId => is.plainObject(recordOrId) ? recordOrId.id : recordOrId);
    const records = await result.get(ids);
    if (isSingular) return records[0] as any;
    return records;
  }



  return {
    get isSyncingEnabled() {

      return result != null;
    },
    get,
    upsert,
    getAllSyncRecords,
    removeSyncRecords,
    markRecordsAsRemoved,
    upsertFromPush,
    markAsSynced,
    unmarkAsSynced,
  };
}
