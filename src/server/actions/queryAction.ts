import { InternalError, is } from '@anupheaus/common';
import { mxdbQueryAction } from '../../common/internalActions';
import { mxdbRefreshQuery } from '../../common/internalEvents';
import { useCollection } from '../collections';
import { useDb } from '../providers';
import { useClient } from '../hooks';
import { createServerAction, useEvent } from '@anupheaus/socket-api/server';

type UseClientType = ReturnType<typeof useClient>;

interface QueryData {
  total: number;
  recordIds: string[];
}

function useClientQueryData(queryId: string, recordIds: string[], total: number, isDataAvailable: UseClientType['isDataAvailable'], getData: UseClientType['getData']) {
  if (!isDataAvailable()) throw new InternalError('Client data is not available when registering for query updates');
  const allQueryData = getData('queryData', () => new Map<string, QueryData>());
  const queryData = allQueryData.getOrSet(queryId, () => ({ total, recordIds }));
  return {
    get oldRecordIds() { return queryData.recordIds; },
    get oldTotal() { return queryData.total; },
    setQueryData(data: QueryData) { allQueryData.set(queryId, data); },
  };
}

export const serverQueryAction = createServerAction(mxdbQueryAction, async ({ collectionName, filters, pagination, sorts, queryId, registrationAction }) => {
  const { collection, query } = useCollection(collectionName);
  const { isDataAvailable, getData } = useClient();
  const { onWatch, removeWatch } = useDb();
  const { pushRecords } = useClient();
  const forceRefreshQuery = useEvent(mxdbRefreshQuery);

  const performQuery = async (): Promise<[string[], number]> => {
    const { data: records, total } = await query({ filters, pagination, sorts }, true);
    await pushRecords(collection, records);
    return [records.ids(), total];
  };

  const [recordIds, total] = await performQuery();

  if (is.not.empty(registrationAction) && is.not.empty(queryId)) {
    const watchId = `mxdb.query.${queryId}`;
    switch (registrationAction) {
      case 'register':
        onWatch(watchId, collection, async () => {
          const { oldRecordIds, oldTotal, setQueryData } = useClientQueryData(queryId, recordIds, total, isDataAvailable, getData);
          const [newRecordIds, newTotal] = await performQuery();
          setQueryData({ total: newTotal, recordIds: newRecordIds });
          // if the new total is different or we have different number of record ids, we need to update
          if (newTotal !== oldTotal || newRecordIds.length !== oldRecordIds.length) { return forceRefreshQuery({ queryId, total: newTotal }); }
          // if the record is new or should now appear in this query or has changed place, we need to update
          if (oldRecordIds.some((id, index) => newRecordIds[index] !== id)) { return forceRefreshQuery({ queryId, total: newTotal }); }
        });
        break;
      case 'unregister':
        removeWatch(watchId);
        break;
    }
  }

  return total;
});