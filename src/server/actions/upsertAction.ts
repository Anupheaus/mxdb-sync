import { createServerAction } from '@anupheaus/socket-api/server';
import { mxdbUpsertAction } from '../../common';
import { useDb } from '../providers';
import { getCollectionExtensions, type UseCollectionFn } from '../collections/extendCollection';
import { useCollection } from '../collections';
import type { Record } from '@anupheaus/common';

export const serverUpsertAction = createServerAction(mxdbUpsertAction, async ({ collectionName, records }) => {
  const db = useDb();
  const dbCollection = db.use<Record>(collectionName);
  const extensions = getCollectionExtensions(dbCollection.collection);
  const useCollectionFn: UseCollectionFn = useCollection;

  const recordIds = records.ids();
  const existing = await dbCollection.get(recordIds);
  const existingIds = (Array.isArray(existing) ? existing : existing ? [existing] : []).ids();
  const insertedIds = recordIds.filter(id => !existingIds.includes(id));
  const updatedIds = recordIds.filter(id => existingIds.includes(id));
  const payload = { records, insertedIds, updatedIds };

  if (extensions?.onBeforeUpsert) await extensions.onBeforeUpsert(payload, useCollectionFn);
  await dbCollection.upsert(records);
  if (extensions?.onAfterUpsert) await extensions.onAfterUpsert(payload, useCollectionFn);
  return recordIds;
});
