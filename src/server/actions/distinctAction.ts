import { createServerActionHandler } from '@anupheaus/socket-api/server';
import { mxdbDistinctAction } from '../../common';
import type { DistinctRequest } from '../../common';
import { configRegistry } from '../../common';
import { useDb, useServerToClientSync } from '../providers';

export async function handleDistinct({ collectionName, field, filters, sorts }: DistinctRequest) {
  const db = useDb();
  const dbCollection = db.use(collectionName);

  const records = await dbCollection.distinct({ field, filters, sorts });
  if (records == null || records.length === 0) return [];

  const config = configRegistry.getOrError(dbCollection.collection);
  const { pushRecordsToClient } = useServerToClientSync();
  await pushRecordsToClient(collectionName, records.ids(), [], config.disableAudit === true);

  return records.ids().join('|').hash();
}


export const serverDistinctAction = createServerActionHandler(mxdbDistinctAction, handleDistinct);
