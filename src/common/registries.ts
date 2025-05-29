import type { Record } from '@anupheaus/common';
import type { MXDBCollection, MXDBCollectionConfig } from './models';

const configs = new WeakMap<MXDBCollection, MXDBCollectionConfig>();

export const configRegistry = {
  add<RecordType extends Record>(collection: MXDBCollection<RecordType>, config: MXDBCollectionConfig<RecordType>): void {
    configs.set(collection, config);
  },
  get<RecordType extends Record>(collection: MXDBCollection<RecordType>): MXDBCollectionConfig<RecordType> | undefined {
    return configs.get(collection);
  },
  getOrError<RecordType extends Record>(collection: MXDBCollection<RecordType>): MXDBCollectionConfig<RecordType> {
    const config = configs.get(collection);
    if (config == null) throw new Error(`Configuration for collection "${collection.name}" could not be found.`);
    return config;
  },
};
