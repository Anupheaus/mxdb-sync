import { mxdbDistinctSubscription } from '../../common';
import { useCollection } from '../collections';
import { useServerToClientSynchronisation } from '../providers';
import { createServerCollectionSubscription } from './createServerCollectionSubscription';
import { pushSubscriptionResultRecords } from './pushSubscriptionResultRecords';

export const serverDistinctSubscription = createServerCollectionSubscription()(mxdbDistinctSubscription,
  async ({ request: { collectionName, ...request }, previousResponse, subscriptionId, update, onUnsubscribe }) => {
    const { collection, distinct, onChange, removeOnChange } = useCollection(collectionName);
    // Capture at subscription-setup time. onChange callbacks fire from the MongoDB change stream
    // outside any ALS context, so a late useServerToClientSynchronisation() would fall back to the no-op.
    const capturedS2C = useServerToClientSynchronisation();

    const runDistinct = () => distinct(request);

    async function refreshDistinctAndPushToSubscriber(): Promise<string[]> {
      const records = await runDistinct();
      await pushSubscriptionResultRecords(capturedS2C, collection, records, []);
      return records.ids();
    }

    const internalSubscriptionId = `mxdb.distinct.${subscriptionId}`;
    onChange(internalSubscriptionId, async () => {
      const newRecordIds = await refreshDistinctAndPushToSubscriber();
      const newHash = newRecordIds.join('|').hash();
      // if the record is new or should now appear in this query or has changed place, we need to update
      if (previousResponse != newHash) { return update(newHash); }
    });

    onUnsubscribe(() => removeOnChange(internalSubscriptionId));

    const recordIds = await refreshDistinctAndPushToSubscriber();

    return recordIds.join('|').hash();
  });
