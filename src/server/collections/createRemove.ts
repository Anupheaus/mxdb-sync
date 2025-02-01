import type { Record } from '@anupheaus/common';
import { getNowTime, useSyncTools, type MongoDocOf, type MXDBSyncedCollection } from '../../common';
import { useDb } from '../providers';
import type { Collection } from 'mongodb';
import { configRegistry } from '../../common/registries';
import type { MXDBSyncServerRecord } from '../../common/internalModels';
import type { SocketAPIUser } from '@anupheaus/socket-api/server';
import { useLogger, useSocketAPI } from '@anupheaus/socket-api/server';

async function writeSyncRecords<RecordType extends Record>(syncCollection: Collection<MongoDocOf<MXDBSyncServerRecord<RecordType>>>, records: RecordType[], existingRecords: RecordType[], user: SocketAPIUser) {
  const logger = useLogger();
  try {
    const { getMatchingRecords, bulkWrite } = useDb();
    const { createDeletedSyncRecordsFromRecords } = useSyncTools();
    const existingSyncRecords = await getMatchingRecords(syncCollection, existingRecords);
    const syncRecords = createDeletedSyncRecordsFromRecords(existingSyncRecords, records, getNowTime(), user.id);
    await bulkWrite(syncCollection, syncRecords);
  } catch (error) {
    logger.error('Sync records we not able to be written', { collection: syncCollection.collectionName, error });
  }
}

export function createRemove<RecordType extends Record>(collection: MXDBSyncedCollection<RecordType>) {
  const { bulkDelete, getMatchingRecords, getCollections } = useDb();
  const config = configRegistry.getOrError(collection);
  const { dataCollection, syncCollection } = getCollections(collection);

  async function remove(record: RecordType): Promise<void>;
  async function remove(records: RecordType[]): Promise<void>;
  async function remove(records: RecordType | RecordType[]): Promise<void> {

    const { getUser } = useSocketAPI();

    if (!Array.isArray(records)) return remove([records]); // make sure we call it with an array
    if (config.disableSync !== true) {
      const user = getUser();
      if (user == null) throw new Error(`A user is required to remove records from the "${collection.name}" collection.`);
      const existingRecords = await getMatchingRecords(dataCollection, records);
      writeSyncRecords(syncCollection, records, existingRecords, user); // fire and don't wait        
    }
    await bulkDelete(dataCollection, records);
  }

  return remove;
}