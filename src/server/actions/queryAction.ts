import { is } from '@anupheaus/common';
import { mxdbQueryAction } from '../../common/internalActions';
import { mxdbPushRecords, mxdbRefreshQuery } from '../../common/internalEvents';
import { useCollection } from '../collections';
import { useEvent } from '../events';
import { useDb } from '../providers';
import { createServerAction } from './createServerAction';

export const serverQueryAction = createServerAction(mxdbQueryAction, async ({ collectionName, filters, pagination, sorts, queryId, registrationAction }) => {
  const { collection, query } = useCollection(collectionName);
  const { onWatch, removeWatch } = useDb();
  const pushRecordsToClient = useEvent(mxdbPushRecords);
  const forceRefreshQuery = useEvent(mxdbRefreshQuery);

  const performQuery = async (): Promise<[string[], number]> => {
    const { data: records, total } = await query({ filters, pagination, sorts });
    await pushRecordsToClient({ collectionName, records });
    return [records.ids(), total];
  };

  const [recordIds, total] = await performQuery();

  if (is.not.empty(registrationAction) && is.not.empty(queryId)) {
    const watchId = `mxdb.query.${queryId}`;
    switch (registrationAction) {
      case 'register':
        onWatch(watchId, collection, async ({ type }) => {
          // we don't need to worry about removals because the client will have already removed them as they are updated if they have that id already
          // we don't need to worry about updates because the client will have already updated them as they are updated if they have that id already
          if (type !== 'upsert') return;
          const [newRecordIds, newTotal] = await performQuery();
          // if the new total is different or we have different number of record ids, we need to update
          if (newTotal !== total || newRecordIds.length !== recordIds.length) { return forceRefreshQuery({ queryId, total: newTotal }); }
          // if the record is new or should now appear in this query or has changed place, we need to update
          if (recordIds.some((id, index) => newRecordIds[index] !== id)) { return forceRefreshQuery({ queryId, total: newTotal }); }
        });
        break;
      case 'unregister':
        removeWatch(watchId);
        break;
    }
  }

  return total;
});