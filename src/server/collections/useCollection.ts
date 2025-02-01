import { is, type Record } from '@anupheaus/common';
import type { MXDBSyncedCollection } from '../../common';
import { createUpsert } from './createUpsert';
import { createClear } from './createClear';
import { createGetRecordCount } from './createGetRecordCount';
import { createGet } from './createGet';
import { createQuery } from './createQuery';
import { createRemove } from './createRemove';
import { useCollections } from './useCollections';

function useTypedCollection<RecordType extends Record>(collection: MXDBSyncedCollection<RecordType>) {
  const upsert = createUpsert(collection);
  const remove = createRemove(collection);
  const clear = createClear(collection);
  const getRecordCount = createGetRecordCount(collection);
  const get = createGet(collection);
  const query = createQuery(collection);

  return {
    collection,
    get,
    query,
    upsert,
    remove,
    clear,
    getRecordCount,
  };
}

type UseCollection<RecordType extends Record> = ReturnType<typeof useTypedCollection<RecordType>>;

export function useCollection<RecordType extends Record>(collection: MXDBSyncedCollection<RecordType>): UseCollection<RecordType>;
export function useCollection<RecordType extends Record = Record>(collectionName: string): UseCollection<RecordType>;
export function useCollection<RecordType extends Record>(collectionOrName: MXDBSyncedCollection<RecordType> | string): UseCollection<RecordType> {
  if (is.string(collectionOrName)) {
    const collections = useCollections();
    if (collections == null) throw new Error('Unable to use useCollection at this location, the collections are not available.');
    const collection = collections.find(({ name }) => name === collectionOrName);
    if (collection == null) throw new Error(`Unable to find collection "${collectionOrName}" in the collections.`);
    return useTypedCollection<RecordType>(collection);
  } else {
    return useTypedCollection<RecordType>(collectionOrName);
  }
}
