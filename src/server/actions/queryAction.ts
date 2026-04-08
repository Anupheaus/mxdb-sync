import { createServerActionHandler } from '@anupheaus/socket-api/server';
import { mxdbQueryAction } from '../../common';
import { useDb, useServerToClientSynchronisation } from '../providers';

export async function handleQuery(params: { collectionName: string;[key: string]: unknown; }) {
  const { collectionName, ...request } = params;
  const db = useDb();
  const s2c = useServerToClientSynchronisation();
  const dbCollection = db.use(collectionName);

  const { data: records, total } = await dbCollection.query(request);
  if (records.length === 0) return [];

  await s2c.seedActive(collectionName, records);

  return total;
}

export const serverQueryAction = createServerActionHandler(mxdbQueryAction, handleQuery);
