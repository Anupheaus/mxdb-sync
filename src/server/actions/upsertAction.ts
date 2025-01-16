import { mxdbUpsertAction } from '../../common';
import { useCollection } from '../collections';
import { createServerAction } from './createServerAction';

export const serverUpsertAction = createServerAction(mxdbUpsertAction, async ({ collectionName, records }) => {
  const { upsert } = useCollection(collectionName);
  const updatedRecords = await upsert(records);
  return updatedRecords.ids();
});