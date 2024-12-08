
import type { Record } from '@anupheaus/common';
import { useDb } from '../providers';
import type { MongoDocOf, MXDBSyncedCollection } from '../../common';

export function createGetRecordCount<RecordType extends Record>(collection: MXDBSyncedCollection<RecordType>) {
  const { db } = useDb();
  const dbCollection = db.collection<MongoDocOf<RecordType>>(collection.name);

  return async () => {
    return await dbCollection.countDocuments();
  };
}