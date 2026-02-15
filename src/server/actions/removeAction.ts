import { createServerAction } from '@anupheaus/socket-api/server';
import { mxdbRemoveAction } from '../../common';
import { useClient } from '../hooks';
import { useDb } from '../providers';
import { useLogger } from '@anupheaus/common';
import { getCollectionExtensions } from '../collections/extendCollection';

export const serverRemoveAction = createServerAction(mxdbRemoveAction, async ({ collectionName, recordIds, locallyOnly }) => {
  const db = useDb();
  const dbCollection = db.use(collectionName);
  const logger = useLogger();
  const { removeFromClientIds } = useClient();
  const extensions = getCollectionExtensions(dbCollection.collection);

  if (locallyOnly) {
    logger.info(`Removing ${recordIds.length} records from client only`, { collectionName, recordIds });
    removeFromClientIds(dbCollection.collection, recordIds);
  } else {
    if (extensions?.onBeforeDelete) await extensions.onBeforeDelete({ recordIds });
    logger.info(`Removing ${recordIds.length} records`, { collectionName, recordIds });
    await dbCollection.delete(recordIds);
  }
});
