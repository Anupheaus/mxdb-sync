import type { Record } from '@anupheaus/common';
import { generateSyncTime, type MongoDocOf, type MXDBSyncedCollection } from '../../common';
import { useDb, useLogger } from '../providers';
import { useAuditTools } from '../hooks';
import type { Collection } from 'mongodb';
import { configRegistry } from '../../common/registries';
import type { MXDBSyncServerRecord } from '../../common/internalModels';

async function writeSyncRecords<RecordType extends Record>(syncCollection: Collection<MongoDocOf<MXDBSyncServerRecord<RecordType>>>, records: RecordType[], existingRecords: RecordType[]) {
  const { logger } = useLogger();
  try {
    const { getMatchingRecords, bulkWrite } = useDb();
    const { generateSyncRecordsFrom } = useAuditTools();
    const existingSyncRecords = await getMatchingRecords(syncCollection, existingRecords);
    const syncRecords = generateSyncRecordsFrom(existingSyncRecords, existingRecords, records, generateSyncTime(), 'TODO');
    await bulkWrite(syncCollection, syncRecords);
  } catch (error) {
    logger.error('Upsert sync records write error', { collection: syncCollection.collectionName, error });
  }
}

export function createUpsert<RecordType extends Record>(collection: MXDBSyncedCollection<RecordType>) {
  const { bulkWrite, getMatchingRecords, getCollections } = useDb();
  const config = configRegistry.getOrError(collection);
  const { dataCollection, syncCollection } = getCollections(collection);

  async function upsert(record: RecordType): Promise<RecordType>;
  async function upsert(records: RecordType[]): Promise<RecordType[]>;
  async function upsert(records: RecordType | RecordType[]): Promise<RecordType | RecordType[]> {
    if (!Array.isArray(records)) return (await upsert([records]))[0]; // make sure we call it with an array
    if (config.disableSync !== true) {
      const existingRecords = await getMatchingRecords(dataCollection, records);
      writeSyncRecords(syncCollection, records, existingRecords); // fire and don't wait        
    }
    await bulkWrite(dataCollection, records);
    return await getMatchingRecords(dataCollection, records);
  }

  return upsert;
}