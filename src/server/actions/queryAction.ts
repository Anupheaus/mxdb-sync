import { createServerAction } from '@anupheaus/socket-api/server';
import { mxdbQueryAction } from '../../common';
import { useClient } from '../hooks';
import { useDb } from '../providers';

export const serverQueryAction = createServerAction(mxdbQueryAction, async ({ collectionName, ...request }) => {
  const db = useDb();
  const dbCollection = db.use(collectionName);
  const { pushRecords } = useClient();

  const { data: records, total } = await dbCollection.query(request);
  if (records.length === 0) return [];
  await pushRecords(dbCollection.collection, records);
  return total;
});