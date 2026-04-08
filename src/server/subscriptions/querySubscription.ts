import { mxdbQuerySubscription } from '../../common';
import { useCollection } from '../collections';
import { useServerToClientSynchronisation } from '../providers';
import { createServerCollectionSubscription } from './createServerCollectionSubscription';
import { pushSubscriptionResultRecords } from './pushSubscriptionResultRecords';

export const serverQuerySubscription = createServerCollectionSubscription<string[]>()(mxdbQuerySubscription,
  async ({ request, previousResponse, subscriptionId, additionalData: previousRecordIds, updateAdditionalData, update, onUnsubscribe }) => {
    const { collectionName, filters, pagination, sorts } = request;
    const { collection, query, onChange, removeOnChange } = useCollection(collectionName);
    // Capture at subscription-setup time. onChange callbacks fire from the MongoDB change stream
    // outside any ALS context, so a late useServerToClientSynchronisation() would fall back to the no-op.
    const capturedS2C = useServerToClientSynchronisation();

    const runQuery = () => query({ filters, pagination, sorts, getAccurateTotal: true });

    async function refreshQueryAndPushToSubscriber(): Promise<[string[], number]> {
      const { data: records, total } = await runQuery();
      await pushSubscriptionResultRecords(capturedS2C, collection, records, []);
      return [records.ids(), total];
    }

    const watchId = `mxdb.query.${subscriptionId}`;
    onChange(watchId, async () => {
      const [newRecordIds, newTotal] = await refreshQueryAndPushToSubscriber();
      // if the new total is different or we have different number of record ids, we need to update
      if (newTotal !== previousResponse || newRecordIds.length !== previousRecordIds?.length) { return update(newTotal); }
      // if the record is new or should now appear in this query or has changed place, we need to update
      if (previousRecordIds.some((id, index) => newRecordIds[index] !== id)) { return update(newTotal); }
    });

    onUnsubscribe(() => removeOnChange(watchId));

    const [recordIds, total] = await refreshQueryAndPushToSubscriber();

    updateAdditionalData(recordIds);

    return total;
  });
