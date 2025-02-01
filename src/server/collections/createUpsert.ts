import type { Record } from '@anupheaus/common';
import { getNowTime, useSyncTools, type MongoDocOf, type MXDBSyncedCollection } from '../../common';
import { useDb } from '../providers';
import type { Collection } from 'mongodb';
import { configRegistry } from '../../common/registries';
import type { MXDBSyncServerRecord } from '../../common/internalModels';
import { useLogger, useSocketAPI } from '@anupheaus/socket-api/server';
import type { SocketAPIUser } from '@anupheaus/socket-api/server';

async function writeSyncRecords<RecordType extends Record>(syncCollection: Collection<MongoDocOf<MXDBSyncServerRecord<RecordType>>>, records: RecordType[], existingRecords: RecordType[], user: SocketAPIUser) {
  const logger = useLogger();
  try {
    const { getMatchingRecords, bulkWrite } = useDb();
    const { createSyncRecordsFromRecords } = useSyncTools();
    const existingSyncRecords = await getMatchingRecords(syncCollection, existingRecords);
    const syncRecords = createSyncRecordsFromRecords(existingSyncRecords, records, getNowTime(), user.id);
    await bulkWrite(syncCollection, syncRecords);
  } catch (error) {
    logger.error('Upsert sync records write error', { collection: syncCollection.collectionName, error });
  }
}

export function createUpsert<RecordType extends Record>(collection: MXDBSyncedCollection<RecordType>) {
  const { bulkWrite, getMatchingRecords, getCollections } = useDb();
  const config = configRegistry.getOrError(collection);
  const { dataCollection, syncCollection } = getCollections(collection);
  const { getUser } = useSocketAPI();

  async function upsert(record: RecordType): Promise<RecordType>;
  async function upsert(records: RecordType[]): Promise<RecordType[]>;
  async function upsert(records: RecordType | RecordType[]): Promise<RecordType | RecordType[]> {
    if (!Array.isArray(records)) return (await upsert([records]))[0]; // make sure we call it with an array
    if (config.disableSync !== true) {
      const user = getUser();
      if (user == null) throw new Error(`A user is required to upsert records to the "${collection.name}" collection.`);
      const existingRecords = await getMatchingRecords(dataCollection, records);
      writeSyncRecords(syncCollection, records, existingRecords, user); // fire and don't wait
    }
    await bulkWrite(dataCollection, records);
    return await getMatchingRecords(dataCollection, records);
  }

  return upsert;
}