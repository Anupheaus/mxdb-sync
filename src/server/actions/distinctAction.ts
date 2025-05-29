import { createServerAction } from '@anupheaus/socket-api/server';
import { mxdbDistinctAction } from '../../common';
import { useClient } from '../hooks';
import { useDb } from '../providers';

export const serverDistinctAction = createServerAction(mxdbDistinctAction, async ({ collectionName, field, filters, sorts }) => {
  const db = useDb();
  const dbCollection = db.use(collectionName);
  const { pushRecords } = useClient();

  const records = await dbCollection.distinct({ field, filters, sorts });
  if (records == null || records.length === 0) return [];
  await pushRecords(dbCollection.collection, records);
  return records.ids().join('|').hash();
});