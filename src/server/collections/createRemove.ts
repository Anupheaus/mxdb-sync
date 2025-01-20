import type { Record } from '@anupheaus/common';
import { generateSyncTime, useSyncTools, type MongoDocOf, type MXDBSyncedCollection } from '../../common';
import { useDb, useLogger } from '../providers';
import type { Collection } from 'mongodb';
import { configRegistry } from '../../common/registries';
import type { MXDBSyncServerRecord } from '../../common/internalModels';

async function writeSyncRecords<RecordType extends Record>(syncCollection: Collection<MongoDocOf<MXDBSyncServerRecord<RecordType>>>, records: RecordType[], existingRecords: RecordType[]) {
  const logger = useLogger();
  try {
    const { getMatchingRecords, bulkWrite } = useDb();
    const { generateDeletedSyncRecordsFrom } = useSyncTools();
    const existingSyncRecords = await getMatchingRecords(syncCollection, existingRecords);
    const syncRecords = generateDeletedSyncRecordsFrom(existingSyncRecords, records, generateSyncTime(), 'TODO');
    await bulkWrite(syncCollection, syncRecords);
  } catch (error) {
    logger.error('Upsert delete sync records write error', { collection: syncCollection.collectionName, error });
  }
}

export function createRemove<RecordType extends Record>(collection: MXDBSyncedCollection<RecordType>) {
  const { bulkDelete, getMatchingRecords, getCollections } = useDb();
  const config = configRegistry.getOrError(collection);
  const { dataCollection, syncCollection } = getCollections(collection);

  async function remove(record: RecordType): Promise<void>;
  async function remove(records: RecordType[]): Promise<void>;
  async function remove(records: RecordType | RecordType[]): Promise<void> {
    if (!Array.isArray(records)) return remove([records]); // make sure we call it with an array
    if (config.disableSync !== true) {
      const existingRecords = await getMatchingRecords(dataCollection, records);
      writeSyncRecords(syncCollection, records, existingRecords); // fire and don't wait        
    }
    await bulkDelete(dataCollection, records);
  }

  return remove;
}