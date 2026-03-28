import { createServerActionHandler } from '@anupheaus/socket-api/server';
import { mxdbGetAllAction } from '../../common';
import { configRegistry } from '../../common';
import { useDb, useServerToClientSync } from '../providers';

export async function handleGetAll(params: { collectionName: string }) {
  const { collectionName } = params;
  const db = useDb();
  const dbCollection = db.use(collectionName);

  const records = await dbCollection.getAll();
  if (records.length === 0) return [];

  const config = configRegistry.getOrError(dbCollection.collection);
  const { pushRecordsToClient } = useServerToClientSync();
  await pushRecordsToClient(collectionName, records.ids(), [], config.disableAudit === true);

  return records.ids();
}

export const serverGetAllAction = createServerActionHandler(mxdbGetAllAction, handleGetAll);
