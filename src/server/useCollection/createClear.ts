
import type { Record } from '@anupheaus/common';
import { useDb } from '../providers';
import type { MongoDocOf, MXDBSyncedCollection } from '../../common';
import type { MXDBSyncRecord } from '../../common/internalModels';
import { configRegistry } from '../../common/registries';

export function createClear<RecordType extends Record>(collection: MXDBSyncedCollection<RecordType>) {
  const { db } = useDb();
  const config = configRegistry.getOrError(collection);
  const dataCollection = db.collection<MongoDocOf<RecordType>>(collection.name);

  return async () => {
    if (config.disableSync !== true) {
      const syncCollection = db.collection<MongoDocOf<MXDBSyncRecord<RecordType>>>(`${collection.name}_sync`);
      syncCollection.deleteMany({ _id: { $exists: true } }); // do not wait on this
    }
    await dataCollection.deleteMany({ _id: { $exists: true } });
  };
}