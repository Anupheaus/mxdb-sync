import { mxdbDistinctSubscription } from '../../common';
import { useCollection } from '../collections';
import { createServerCollectionSubscription } from './createServerCollectionSubscription';
import { pushSubscriptionResultRecords } from './pushSubscriptionResultRecords';

export const serverDistinctSubscription = createServerCollectionSubscription()(mxdbDistinctSubscription,
  async ({ request: { collectionName, ...request }, previousResponse, subscriptionId, update, onUnsubscribe }) => {
    const { collection, distinct, onChange, removeOnChange } = useCollection(collectionName);

    const runDistinct = () => distinct(request);

    async function refreshDistinctAndPushToSubscriber(): Promise<string[]> {
      const records = await runDistinct();
      await pushSubscriptionResultRecords(collection, records, []);
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
