import { mxdbRemoveAction } from '../../common';
import { useCollection } from '../collections';
import { useLogger } from '../providers';
import { createServerAction } from './createServerAction';

export const serverRemoveAction = createServerAction(mxdbRemoveAction, async ({ collectionName, recordIds }) => {
  const logger = useLogger();
  const { remove, get: getRecords } = useCollection(collectionName);

  logger.info(`Removing ${recordIds.length} records`, { collectionName, recordIds });
  const records = await getRecords(recordIds);
  await remove(records);
});