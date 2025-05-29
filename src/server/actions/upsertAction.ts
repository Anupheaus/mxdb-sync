import { createServerAction } from '@anupheaus/socket-api/server';
import { mxdbUpsertAction } from '../../common';
import { useDb } from '../providers';
import type { Record } from '@anupheaus/common';

export const serverUpsertAction = createServerAction(mxdbUpsertAction, async ({ collectionName, records }) => {
  const db = useDb();
  const dbCollection = db.use<Record>(collectionName);

  await dbCollection.upsert(records);
  return records.ids();
});
