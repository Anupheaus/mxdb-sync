import { createServerAction } from '@anupheaus/socket-api/server';
import { mxdbGetAction } from '../../common';
import { useClient } from '../hooks';
import { useDb } from '../providers';

export async function handleGet(params: { collectionName: string; ids: string[] }) {
  const { collectionName, ids } = params;
  const db = useDb();
  const dbCollection = db.use(collectionName);
  const { pushRecords } = useClient();

  const records = await dbCollection.get(ids);
  if (records == null || records.length === 0) return [];
  await pushRecords(dbCollection.collection, records);
  return records.ids();
}

export const serverGetAction = createServerAction(mxdbGetAction, handleGet);