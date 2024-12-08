import type { Record } from '@anupheaus/common';
import type { MXDBSyncedCollection } from '../../common';
import { createUpsert } from './createUpsert';
import { createClear } from './createClear';
import { createGetRecordCount } from './createGetRecordCount';
import { createGet } from './createGet';
import { createQuery } from './createQuery';

export function useCollection<RecordType extends Record>(collection: MXDBSyncedCollection<RecordType>) {
  const upsert = createUpsert(collection);
  const clear = createClear(collection);
  const getRecordCount = createGetRecordCount(collection);
  const get = createGet(collection);
  const query = createQuery(collection);

  return {
    get,
    query,
    upsert,
    clear,
    getRecordCount,
  };
}