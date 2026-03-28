import { useLogger } from '@anupheaus/common';
import { setDb, setServerToClientSync } from './DbContext';
import { ServerDb } from './ServerDb';
import type { MXDBCollection } from '../../../common';
import { ServerToClientSynchronisation } from '../../ServerToClientSynchronisation';

export function provideDb<R>(
  mongoDbName: string,
  mongoDbUrl: string,
  collections: MXDBCollection[],
  delegate: (db: ServerDb) => R,
  changeStreamDebounceMs?: number,
): R {
  const logger = useLogger();

  const db = new ServerDb({
    mongoDbName,
    mongoDbUrl,
    collections,
    logger,
    changeStreamDebounceMs,
  });

  setDb(db);
  setServerToClientSync(ServerToClientSynchronisation.createNoOp(collections));
  return delegate(db);
}
