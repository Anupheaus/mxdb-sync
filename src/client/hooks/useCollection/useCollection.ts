import type { Record } from '@anupheaus/common';
import type { MXDBCollection } from '../../../common';
import { createGet } from './createGet';
import { createUseGet } from './createUseGet';
import { createUpsert } from './createUpsert';
import { createRemove } from './createRemove';
import { createQuery } from './createQuery';
import { createUseQuery } from './createUseQuery';
import { createTableRequest } from './createTableRequest';
import { createUseSubscription } from './createUseSubscription';
import { createDistinct } from './createDistinct';
import { createFind } from './createFind';
import { createUseDistinct } from './createUseDistinct';
import { useLogger } from '@anupheaus/react-ui';
import { useDb } from '../../providers';
import { useUser } from '@anupheaus/socket-api/client';
import { createGetAll } from './createGetAll';
import { configRegistry } from '../../../common/registries';

export function useCollection<RecordType extends Record>(collection: MXDBCollection<RecordType>, dbName?: string) {
  const { db } = useDb(dbName);
  const { user } = useUser();
  const userId = user?.id ?? Math.emptyId();
  const config = configRegistry.getOrError(collection);
  const dbCollection = db.use<RecordType>(collection.name);
  const logger = useLogger(collection.name);

  const get = createGet(dbCollection);
  const getAll = createGetAll(dbCollection);
  const upsert = createUpsert(dbCollection, userId, logger);
  const remove = createRemove(dbCollection, userId, logger);
  const useSubscription = createUseSubscription();
  const makeNewQuery = () => createQuery(dbCollection, useSubscription, logger);
  const query = makeNewQuery();
  const distinct = createDistinct(dbCollection, useSubscription, logger);
  const find = createFind(makeNewQuery());
  const tableRequest = createTableRequest(makeNewQuery());
  const useGet = createUseGet(dbCollection, get);
  const useQuery = createUseQuery(makeNewQuery());
  const useDistinct = createUseDistinct(distinct);
  const onChange = dbCollection.onChange;

  return {
    config,
    get,
    getAll,
    upsert,
    remove,
    query,
    find,
    distinct,
    useGet,
    useQuery,
    useDistinct,
    useSubscription,
    tableRequest,
    onChange,
  };
}
