import type { Record } from '@anupheaus/common';
import type { MXDBSyncedCollection, MXDBSyncedCollectionConfig } from './models';
import { defineCollection as mxdbDefinedCollection } from '@anupheaus/mxdb/common';
import { configRegistry, syncCollectionRegistry } from './registries';
import type { MXDBSyncRecord } from './internalModels';

export function defineCollection<RecordType extends Record>(config: MXDBSyncedCollectionConfig<RecordType>): MXDBSyncedCollection<RecordType> {
  const collection: MXDBSyncedCollection<RecordType> = mxdbDefinedCollection(config);
  const syncCollection = mxdbDefinedCollection<MXDBSyncRecord<RecordType>>({
    name: `${collection.name}_sync`,
    indexes: [] as any,
    version: 1,
  });
  configRegistry.add(collection, config);
  syncCollectionRegistry.add(collection, syncCollection);
  return collection;
}
