import { createServerActionHandler } from '@anupheaus/socket-api/server';
import { mxdbGetAction } from '../../common';
import { configRegistry } from '../../common';
import { useDb, useServerToClientSync } from '../providers';

export async function handleGet(params: { collectionName: string; ids: string[]; }) {
  const { collectionName, ids } = params;
  const db = useDb();
  const { pushRecordsToClient } = useServerToClientSync();
  const dbCollection = db.use(collectionName);

  const records = await dbCollection.get(ids);
  if (records == null || records.length === 0) return [];

  const config = configRegistry.getOrError(dbCollection.collection);
  await pushRecordsToClient(collectionName, records.ids(), [], config.disableAudit === true);

  return records.ids();
}

export const serverGetAction = createServerActionHandler(mxdbGetAction, handleGet);
