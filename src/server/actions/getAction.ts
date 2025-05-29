import { createServerAction } from '@anupheaus/socket-api/server';
import { mxdbGetAction } from '../../common';
import { useClient } from '../hooks';
import { useDb } from '../providers';

export const serverGetAction = createServerAction(mxdbGetAction, async ({ collectionName, ids }) => {
  const db = useDb();
  const dbCollection = db.use(collectionName);
  const { pushRecords } = useClient();

  const records = await dbCollection.get(ids);
  if (records == null || records.length === 0) return [];
  await pushRecords(dbCollection.collection, records);
  return records.ids();
});