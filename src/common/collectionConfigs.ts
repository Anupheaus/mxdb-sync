// import { InternalError, Record } from '@anupheaus/common';
// import { MXDBSyncedCollection, MXDBSyncedCollectionConfig } from './models';

// export const collectionConfigs = new WeakMap<MXDBSyncedCollection, MXDBSyncedCollectionConfig>();

// export function getCollectionConfig<RecordType extends Record>(collection: MXDBSyncedCollection<RecordType>) {
//   const config = collectionConfigs.get(collection);
//   if (!config) throw new InternalError(`Collection config not found for collection "${collection.name}".`);
//   return config;
// }
