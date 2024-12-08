import type { Logger, Record } from '@anupheaus/common';
import type { MongoDocOf, MXDBSyncedCollection } from '../../common';
import { useClientIds, useDb } from '../providers';
import { SyncEvents } from '../../common/syncEvents';

export function createCollectionGet<RecordType extends Record>(syncCollection: MXDBSyncedCollection<RecordType>, logger: Logger) {
  const { db, fromMongoDoc } = useDb();
  const { addToClientIds } = useClientIds();
  const collection = db.collection<MongoDocOf<RecordType>>(syncCollection.name);

  return SyncEvents.collection(syncCollection).get.createSocketHandler(async id => {
    logger.info('get', { id });
    const mongoRecords = await collection.find({ _id: id } as any).toArray();
    const records = mongoRecords.map(fromMongoDoc);
    logger.info('get', { records });
    const record = records[0];
    if (record != null) addToClientIds(syncCollection.name, [record.id]);
    return record;
  });
}