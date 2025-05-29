import { useLogger } from '@anupheaus/common';
import { DbProvider } from './DbContext';
import { ServerDb } from './ServerDb';
import type { MXDBCollection } from '../../../common';

export function provideDb<R>(mongoDbName: string, mongoDbUrl: string, collections: MXDBCollection[], delegate: (db: ServerDb) => R): R {
  const logger = useLogger();

  const db = new ServerDb({
    mongoDbName,
    mongoDbUrl,
    collections,
    logger,
  });

  return DbProvider.run(db, () => delegate(db));
}
