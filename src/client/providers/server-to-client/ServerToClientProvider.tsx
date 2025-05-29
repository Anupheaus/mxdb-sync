import { createComponent } from '@anupheaus/react-ui';
import { useEvent, useUser } from '@anupheaus/socket-api/client';
import { mxdbServerPush } from '../../../common';
import { useDb } from '../dbs';

export const ServerToClientProvider = createComponent('ServerToClientProvider', () => {
  const onServerPush = useEvent(mxdbServerPush);
  const { db } = useDb();
  const { getUser } = useUser();

  onServerPush(async event => {
    const collection = db.use(event.collectionName);
    const user = getUser();
    const userId = user?.id ?? Math.emptyId();

    if (event.updatedRecords.length > 0) await collection.upsert(event.updatedRecords, userId, { auditAction: 'branched', ifHasHistory: 'doNotUpsert' });

    if (event.removedRecordIds.length > 0) await collection.delete(event.removedRecordIds, userId, { auditAction: 'remove', keepIfHasHistory: true });
  });

  return null;
});
