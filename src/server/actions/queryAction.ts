import { createServerActionHandler } from '@anupheaus/socket-api/server';
import { mxdbQueryAction } from '../../common';
import { configRegistry } from '../../common';
import { useDb, useServerToClientSync } from '../providers';

export async function handleQuery(params: { collectionName: string;[key: string]: unknown; }) {
  const { collectionName, ...request } = params;
  const db = useDb();
  const dbCollection = db.use(collectionName);

  const { data: records, total } = await dbCollection.query(request);
  if (records.length === 0) return [];

  const config = configRegistry.getOrError(dbCollection.collection);
  const { pushRecordsToClient } = useServerToClientSync();
  await pushRecordsToClient(collectionName, records.ids(), [], config.disableAudit === true);

  return total;
}

export const serverQueryAction = createServerActionHandler(mxdbQueryAction, handleQuery);
