import { createServerAction } from '@anupheaus/socket-api/server';
import { mxdbDistinctAction } from '../../common';
import type { DistinctRequest } from '../../common';
import { useClient } from '../hooks';
import { useDb } from '../providers';

export async function handleDistinct({ collectionName, field, filters, sorts }: DistinctRequest) {
  const db = useDb();
  const dbCollection = db.use(collectionName);
  const { pushRecords } = useClient();

  const records = await dbCollection.distinct({ field, filters, sorts });
  if (records == null || records.length === 0) return [];
  await pushRecords(dbCollection.collection, records);
  return records.ids().join('|').hash();
}


export const serverDistinctAction = createServerAction(mxdbDistinctAction, handleDistinct);