import { createServerAction } from '@anupheaus/socket-api/server';
import { mxdbRemoveAction } from '../../common';
import { useClient } from '../hooks';
import { useDb } from '../providers';
import { useLogger } from '@anupheaus/common';

export const serverRemoveAction = createServerAction(mxdbRemoveAction, async ({ collectionName, recordIds, locallyOnly }) => {
  const db = useDb();
  const dbCollection = db.use(collectionName);
  const logger = useLogger();
  const { removeFromClientIds } = useClient();


  if (locallyOnly) {
    logger.info(`Removing ${recordIds.length} records from client only`, { collectionName, recordIds });
    removeFromClientIds(dbCollection.collection, recordIds);
  } else {
    logger.info(`Removing ${recordIds.length} records`, { collectionName, recordIds });
    await dbCollection.delete(recordIds);
  }
});
