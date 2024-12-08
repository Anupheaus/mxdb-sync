import type { Record } from '@anupheaus/common';
import type { MXDBSyncedCollection, MXDBSyncedCollectionConfig } from './models';
import type { MXDBCollection } from '@anupheaus/mxdb';
import type { MXDBSyncClientRecord, MXDBSyncRecord, MXDBSyncServerRecord } from './internalModels';

const configs = new WeakMap<MXDBSyncedCollection, MXDBSyncedCollectionConfig>();

export const configRegistry = {
  add<RecordType extends Record>(collection: MXDBSyncedCollection<RecordType>, config: MXDBSyncedCollectionConfig<RecordType>): void {
    configs.set(collection, config);
  },
  get<RecordType extends Record>(collection: MXDBSyncedCollection<RecordType>): MXDBSyncedCollectionConfig<RecordType> | undefined {
    return configs.get(collection);
  },
  getOrError<RecordType extends Record>(collection: MXDBSyncedCollection<RecordType>): MXDBSyncedCollectionConfig<RecordType> {
    const config = configs.get(collection);
    if (config == null) throw new Error(`Configuration for collection "${collection.name}" could not be found.`);
    return config;
  },
};

const syncCollections = new WeakMap<MXDBSyncedCollection, MXDBCollection<MXDBSyncRecord<any>>>();

export const syncCollectionRegistry = {
  add<RecordType extends Record>(collection: MXDBSyncedCollection<RecordType>, syncCollection: MXDBCollection<MXDBSyncRecord<RecordType>>): void {
    syncCollections.set(collection, syncCollection);
  },
  getForClient<RecordType extends Record>(collection: MXDBSyncedCollection<RecordType>): MXDBCollection<MXDBSyncClientRecord<RecordType>> | undefined {
    return syncCollections.get(collection) as MXDBCollection<MXDBSyncClientRecord<RecordType>> | undefined;
  },
  getForServer<RecordType extends Record>(collection: MXDBSyncedCollection<RecordType>): MXDBCollection<MXDBSyncServerRecord<RecordType>> | undefined {
    return syncCollections.get(collection) as MXDBCollection<MXDBSyncServerRecord<RecordType>> | undefined;
  },
};
