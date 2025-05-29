import type { Unsubscribe, Record } from '@anupheaus/common';
import { is } from '@anupheaus/common';
import type { MXDBCollection, MXDBOnChangeEvent } from '../../common';
import type { ServerDb, ServerDbCollection } from '../providers';
import { useDb } from '../providers';

const subscriptionIds = new Map<string, Unsubscribe>();

function createOnChange(db: ServerDb, dbCollection: ServerDbCollection<any>) {
  function onChange(subscriptionId: string, callback: (record: MXDBOnChangeEvent) => void): void;
  function onChange(callback: (record: MXDBOnChangeEvent) => void): Unsubscribe;
  function onChange(subscriptionIdOrCallback: string | ((record: MXDBOnChangeEvent) => void), callback?: (record: MXDBOnChangeEvent) => void) {
    callback = is.function(subscriptionIdOrCallback) ? subscriptionIdOrCallback : callback;
    const subscriptionId = is.not.blank(subscriptionIdOrCallback) ? subscriptionIdOrCallback : undefined;
    if (callback == null) throw new Error('Callback is required to subscribe to changes for this collection');
    const unsubscribe = db.onChange(event => {
      if (event.collectionName !== dbCollection.name) return;
      callback!(event);
    });
    if (subscriptionId != null) subscriptionIds.set(subscriptionId, unsubscribe);
    return unsubscribe;
  }

  return onChange;
}

function useTypedCollection<RecordType extends Record>(db: ServerDb, dbCollection: ServerDbCollection<RecordType>) {
  return {
    collection: dbCollection.collection,
    get: dbCollection.get,
    query: dbCollection.query,
    find: dbCollection.find,
    upsert: dbCollection.upsert,
    remove: dbCollection.delete,
    distinct: dbCollection.distinct,
    clear: dbCollection.clear,
    getRecordCount: dbCollection.count,
    getAll: dbCollection.getAll,
    sync: dbCollection.sync,
    onChange: createOnChange(db, dbCollection),
    removeOnChange: (subscriptionId: string) => {
      const unsubscribe = subscriptionIds.get(subscriptionId);
      if (unsubscribe == null) return;
      unsubscribe();
      subscriptionIds.delete(subscriptionId);
    },
  };
}

type UseCollection<RecordType extends Record> = ReturnType<typeof useTypedCollection<RecordType>>;

export function useCollection<RecordType extends Record>(collection: MXDBCollection<RecordType>): UseCollection<RecordType>;
export function useCollection<RecordType extends Record = Record>(collectionName: string): UseCollection<RecordType>;
export function useCollection<RecordType extends Record>(collectionOrName: MXDBCollection<RecordType> | string): UseCollection<RecordType> {
  const db = useDb();
  const collection = db.use<RecordType>(is.string(collectionOrName) ? collectionOrName : collectionOrName.name);
  return useTypedCollection<RecordType>(db, collection);
}
