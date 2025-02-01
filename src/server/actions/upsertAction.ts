import { createServerAction } from '@anupheaus/socket-api/server';
import { mxdbUpsertAction } from '../../common';
import { useCollection } from '../collections';

export const serverUpsertAction = createServerAction(mxdbUpsertAction, async ({ collectionName, records }) => {
  const { upsert } = useCollection(collectionName);
  const updatedRecords = await upsert(records);
  return updatedRecords.ids();
});