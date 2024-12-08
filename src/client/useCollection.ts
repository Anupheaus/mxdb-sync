import type { Record } from '@anupheaus/common';
import type { MXDBSyncedCollection } from '../common';
import { createGet } from './createGet';
import { createUseGet } from './createUseGet';
import { createUpsert } from './createUpsert';
import { createRemove } from './createRemove';
import { createQuery } from './createQuery';
import { createUseQuery } from './createUseQuery';
import { createTableRequest } from './createTableRequest';
import { useLogger } from './logger';

export function useCollection<RecordType extends Record>(collection: MXDBSyncedCollection<RecordType>, dbName?: string) {
  const logger = useLogger(collection.name);
  const upsert = createUpsert(collection, dbName);
  const get = createGet(collection, dbName);
  const remove = createRemove(collection, dbName);
  // we use a new query each time because each instance has a query id, which is monitored for changes on the server.
  const makeNewQuery = () => createQuery(collection, dbName, logger);
  const query = makeNewQuery();
  const useGet = createUseGet(collection, get, dbName);
  const useQuery = createUseQuery(collection, makeNewQuery(), dbName);
  const gridRequest = createTableRequest(makeNewQuery());

  return {
    get,
    upsert,
    remove,
    query,
    useGet,
    useQuery,
    gridRequest,
  };
}
